// Keep remediation retests bound to the server-created criteria that the backend
// requires. Ordinary Guard calls remain valid runtime evidence, but they must not
// be mistaken for a remediation retest unless retestCriteriaId is present.
//
// Important trust rule: never reconstruct missing criteria from a remediation title.
// If the browser did not observe the exact criteria the user saved, return the
// remediation to evidence_attached so the user can declare a fresh, auditable set.
(() => {
  const originalFetch = window.fetch.bind(window);
  const criteriaDrafts = new Map();
  const STORAGE_KEY = 'arl_runtime_retest_workflow_v1';

  function loadStored() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveStored(value) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }

  function safeText(value) {
    return String(value ?? '').trim();
  }

  function exactCriteria(record) {
    const ruleId = safeText(record?.ruleId).toUpperCase();
    const expectedDecision = safeText(record?.expectedDecision).toLowerCase();
    const actionType = safeText(record?.actionType).toLowerCase();
    const targetIdentity = safeText(record?.targetIdentity).toLowerCase();
    if (!ruleId || !['allow', 'deny'].includes(expectedDecision)
      || !['tool', 'content.input', 'content.output'].includes(actionType) || !targetIdentity) return null;
    return { ruleId, expectedDecision, actionType, targetIdentity };
  }

  function captureCriteriaForm(event) {
    const form = event.target?.closest?.('[data-retest-criteria-form]');
    if (!form) return;
    const data = new FormData(form);
    const remediationId = safeText(form.dataset.retestCriteriaForm);
    if (!remediationId) return;
    const draft = {
      remediationId,
      ruleId: safeText(data.get('ruleId')).toUpperCase(),
      expectedDecision: safeText(data.get('expectedDecision')).toLowerCase(),
      actionType: safeText(data.get('actionType')).toLowerCase(),
      targetIdentity: safeText(data.get('targetIdentity')).toLowerCase(),
    };
    if (!exactCriteria(draft)) return;
    criteriaDrafts.set(remediationId, draft);
    const stored = loadStored();
    stored[remediationId] = { ...(stored[remediationId] || {}), ...draft, exactCriteriaCaptured: true };
    saveStored(stored);
  }

  document.addEventListener('submit', captureCriteriaForm, true);

  function remediationRows(project) {
    return Array.isArray(project?.remediations) ? project.remediations : [];
  }

  function rememberProject(project) {
    if (!project?.id) return;
    const stored = loadStored();
    for (const item of remediationRows(project)) {
      const remediationId = safeText(item.id);
      if (!remediationId) continue;
      if (item.status !== 'ready_for_retest') {
        if (stored[remediationId]?.criteriaId) delete stored[remediationId];
        continue;
      }
      const criteriaId = safeText(item?.verification?.retestCriteriaId);
      if (!criteriaId) continue;
      const draft = criteriaDrafts.get(remediationId) || stored[remediationId] || {};
      stored[remediationId] = {
        ...draft,
        remediationId,
        projectId: safeText(project.id),
        remediationTitle: safeText(item.title),
        criteriaId,
      };
    }
    saveStored(stored);
    scheduleRender();
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, location.origin);
      if (response.ok && /^\/api\/projects\/[^/]+$/.test(url.pathname)) {
        const payload = await response.clone().json();
        if (payload?.project) rememberProject(payload.project);
      }
    } catch {
      // Guidance must never interfere with the actual request or response.
    }
    return response;
  };

  function requestBody(record) {
    const criteria = exactCriteria(record);
    if (!criteria) return null;
    const requestId = `retest-${criteria.targetIdentity.replace(/[^a-z0-9._-]+/gi, '-')}-${Date.now()}`;
    const body = {
      request_id: requestId,
      retestCriteriaId: record.criteriaId,
      metadata: { application: 'agent-retest' },
    };
    if (criteria.actionType === 'tool') {
      body.input = 'Bound remediation retest. Do not execute any external action unless AgentRiskLayer allows it.';
      body.tool_call = { name: criteria.targetIdentity, arguments: { command: 'echo arl-retest' } };
    } else if (criteria.actionType === 'content.input') {
      body.input = criteria.targetIdentity;
    } else if (criteria.actionType === 'content.output') {
      body.output = criteria.targetIdentity;
    }
    return body;
  }

  function curlFor(record) {
    const request = requestBody(record);
    if (!request) return '';
    const body = JSON.stringify(request, null, 2).replace(/'/g, "'\\''");
    return `read -rsp "AgentRiskLayer connection key: " ARL_KEY\necho\n\ncurl -sS https://agentrisklayer.com/v1/guard \\\n  -H "Authorization: Bearer $ARL_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'\n\nunset ARL_KEY\necho`;
  }

  async function copyBoundRequest(button) {
    const remediationId = button.dataset.copyBoundRetest;
    const record = loadStored()[remediationId] || {};
    const command = curlFor(record);
    if (!command) return;
    button.classList.add('retest-action-busy');
    await navigator.clipboard.writeText(command);
    const previous = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = previous;
      button.classList.remove('retest-action-busy');
    }, 1200);
  }

  async function resetRetestCriteria(button) {
    const remediationId = safeText(button.dataset.resetBoundRetest);
    const record = loadStored()[remediationId] || {};
    const projectId = safeText(record.projectId || sessionStorage.getItem('arl_selected_project'));
    if (!projectId || !remediationId) return;
    const panel = button.closest('[data-bound-retest-guidance]');
    const previous = button.textContent;
    button.classList.add('retest-action-busy');
    button.disabled = true;
    button.textContent = 'Resetting…';
    if (panel) panel.dataset.busy = 'true';
    try {
      const { api } = await import('./shared.js');
      await api(`/api/projects/${encodeURIComponent(projectId)}/remediations/${encodeURIComponent(remediationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'evidence_attached' }),
      });
      const stored = loadStored();
      delete stored[remediationId];
      saveStored(stored);
      criteriaDrafts.delete(remediationId);
      location.hash = 'remediation';
      location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = previous;
      button.classList.remove('retest-action-busy');
      if (panel) {
        delete panel.dataset.busy;
        let errorBox = panel.querySelector('[data-bound-retest-error]');
        if (!errorBox) {
          errorBox = document.createElement('p');
          errorBox.dataset.boundRetestError = '';
          errorBox.className = 'error-box show';
          panel.append(errorBox);
        }
        errorBox.textContent = error?.message || 'Could not reset retest criteria.';
      }
    }
  }

  function guidanceSignature(record) {
    const criteria = exactCriteria(record);
    return criteria && record.exactCriteriaCaptured === true
      ? `run:${record.criteriaId}:${criteria.ruleId}:${criteria.expectedDecision}:${criteria.actionType}:${criteria.targetIdentity}`
      : `reset:${record.criteriaId}`;
  }

  function renderBoundRetestGuidance() {
    const stored = loadStored();
    let rendered = false;
    for (const [remediationId, record] of Object.entries(stored)) {
      if (!record?.criteriaId) continue;
      const row = document.querySelector(`[data-remediation-id="${CSS.escape(remediationId)}"] .remediation-detail`);
      if (!row) continue;
      let panel = row.querySelector('[data-bound-retest-guidance]');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'notice info bound-retest-guidance';
        panel.dataset.boundRetestGuidance = remediationId;
        row.prepend(panel);
      }
      if (panel.dataset.busy === 'true') {
        rendered = true;
        continue;
      }
      const signature = guidanceSignature(record);
      if (panel.dataset.renderSignature === signature) {
        rendered = true;
        continue;
      }
      const criteria = exactCriteria(record);
      if (criteria && record.exactCriteriaCaptured === true) {
        panel.innerHTML = `<strong>Run the bound retest next</strong><p>The server requires this retest criteria ID. A normal Guard request without it will remain runtime evidence but will not satisfy this remediation.</p><p><strong>Expected:</strong> ${criteria.expectedDecision} · ${criteria.ruleId} · ${criteria.actionType} · <code>${criteria.targetIdentity}</code></p><button class="button primary small" type="button" data-copy-bound-retest="${remediationId}">Copy bound retest command</button>`;
        panel.querySelector('[data-copy-bound-retest]')?.addEventListener('click', (event) => copyBoundRequest(event.currentTarget));
      } else {
        panel.innerHTML = `<strong>Retest criteria must be declared again</strong><p>This retest was created before the browser captured its exact rule, decision, action type and target. AgentRiskLayer will not guess those security criteria. Reset this retest, then save the four criteria again before running the generated command.</p><button class="button primary small" type="button" data-reset-bound-retest="${remediationId}">Reset retest criteria</button>`;
        panel.querySelector('[data-reset-bound-retest]')?.addEventListener('click', (event) => resetRetestCriteria(event.currentTarget));
      }
      panel.dataset.renderSignature = signature;
      rendered = true;
    }
    return rendered;
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderBoundRetestGuidance();
    }, 0);
  }

  async function recoverExistingRetest() {
    const projectId = safeText(sessionStorage.getItem('arl_selected_project'));
    if (!projectId) return;
    try {
      const response = await originalFetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.project) rememberProject(payload.project);
    } catch {
      // Recovery is UX-only. Never interfere with the authoritative workflow.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recoverExistingRetest, { once: true });
  } else {
    recoverExistingRetest();
  }

  // The main module renders after API calls. A short bounded poll is enough to
  // place the guidance without a self-triggering DOM observer loop.
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    renderBoundRetestGuidance();
    if (attempts >= 60) window.clearInterval(timer);
  }, 100);
})();
