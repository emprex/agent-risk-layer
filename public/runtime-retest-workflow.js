// Keep remediation retests bound to the server-created criteria that the backend
// requires. Ordinary Guard calls remain valid runtime evidence, but they must not
// be mistaken for a remediation retest unless retestCriteriaId is present.
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
    criteriaDrafts.set(remediationId, draft);
    const stored = loadStored();
    stored[remediationId] = { ...(stored[remediationId] || {}), ...draft };
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
      const criteriaId = safeText(item?.verification?.retestCriteriaId);
      if (!criteriaId || item.status !== 'ready_for_retest') continue;
      const remediationId = safeText(item.id);
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

  function fallbackDetails(record) {
    const title = safeText(record.remediationTitle).toLowerCase();
    if ((!record.actionType || !record.targetIdentity) && title.includes('shell')) {
      return { ...record, actionType: 'tool', targetIdentity: 'shell', expectedDecision: record.expectedDecision || 'deny', ruleId: record.ruleId || 'ARL-RUN-002' };
    }
    return record;
  }

  function requestBody(record) {
    const requestId = `retest-${safeText(record.targetIdentity || 'control').replace(/[^a-z0-9._-]+/gi, '-')}-${Date.now()}`;
    const body = {
      request_id: requestId,
      retestCriteriaId: record.criteriaId,
      metadata: { application: 'agent-retest' },
    };
    if (record.actionType === 'tool') {
      body.input = 'Bound remediation retest. Do not execute any external action unless AgentRiskLayer allows it.';
      body.tool_call = { name: record.targetIdentity, arguments: { command: 'echo arl-retest' } };
    } else if (record.actionType === 'content.input') {
      body.input = record.targetIdentity;
    } else if (record.actionType === 'content.output') {
      body.output = record.targetIdentity;
    }
    return body;
  }

  function curlFor(record) {
    const body = JSON.stringify(requestBody(record), null, 2).replace(/'/g, "'\\''");
    return `read -rsp "AgentRiskLayer connection key: " ARL_KEY\necho\n\ncurl -sS https://agentrisklayer.com/v1/guard \\\n  -H "Authorization: Bearer $ARL_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'\n\nunset ARL_KEY\necho`;
  }

  async function copyBoundRequest(button) {
    const remediationId = button.dataset.copyBoundRetest;
    const record = fallbackDetails(loadStored()[remediationId] || {});
    if (!record.criteriaId || !record.actionType || !record.targetIdentity) return;
    await navigator.clipboard.writeText(curlFor(record));
    const previous = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = previous; }, 1200);
  }

  function renderBoundRetestGuidance() {
    const stored = loadStored();
    let rendered = false;
    for (const [remediationId, raw] of Object.entries(stored)) {
      const record = fallbackDetails(raw);
      if (!record.criteriaId) continue;
      const row = document.querySelector(`[data-remediation-id="${CSS.escape(remediationId)}"] .remediation-detail`);
      if (!row) continue;
      let panel = row.querySelector('[data-bound-retest-guidance]');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'notice info bound-retest-guidance';
        panel.dataset.boundRetestGuidance = remediationId;
        row.prepend(panel);
      }
      const complete = Boolean(record.actionType && record.targetIdentity);
      panel.innerHTML = complete
        ? `<strong>Run the bound retest next</strong><p>The server requires this retest criteria ID. A normal Guard request without it will remain runtime evidence but will not satisfy this remediation.</p><p><strong>Expected:</strong> ${record.expectedDecision || 'saved decision'} · ${record.ruleId || 'saved rule'} · ${record.actionType} · <code>${record.targetIdentity}</code></p><button class="button primary small" type="button" data-copy-bound-retest="${remediationId}">Copy bound retest command</button>`
        : `<strong>Run the bound retest next</strong><p>Retest criteria are active. Use the saved target and include <code>retestCriteriaId</code> <code>${record.criteriaId}</code> in the next Guard request. Ordinary Guard requests do not count as remediation retests.</p>`;
      panel.querySelector('[data-copy-bound-retest]')?.addEventListener('click', (event) => copyBoundRequest(event.currentTarget));
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

  // Recover an already-created ready-for-retest record after deploy/refresh. This
  // fixes the real production case where criteria existed before this helper was
  // loaded, so there was no client-side draft to intercept.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recoverExistingRetest, { once: true });
  } else {
    recoverExistingRetest();
  }

  // The main module renders after API calls. A short bounded poll is enough to
  // place the guidance without a MutationObserver or a self-triggering loop.
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    renderBoundRetestGuidance();
    if (attempts >= 60) window.clearInterval(timer);
  }, 100);
})();
