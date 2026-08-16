// Keep the bound-retest action outside the dynamic Runtime application root so
// ordinary project re-renders cannot make the action disappear. Reconcile the
// server-issued criteria id directly from the current project instead of relying
// on interception timing in another helper.
(() => {
  const STORAGE_KEY = 'arl_runtime_retest_workflow_v1';
  const PANEL_ID = 'arlPersistentBoundRetest';
  let reconcilePromise = null;

  function safeText(value) { return String(value ?? '').trim(); }

  function loadStored() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveStored(value) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }

  function records() { return Object.values(loadStored()); }

  function exact(record) {
    const ruleId = safeText(record?.ruleId).toUpperCase();
    const expectedDecision = safeText(record?.expectedDecision).toLowerCase();
    const actionType = safeText(record?.actionType).toLowerCase();
    const targetIdentity = safeText(record?.targetIdentity).toLowerCase();
    if (!safeText(record?.criteriaId) || record?.exactCriteriaCaptured !== true || !ruleId
      || !['allow', 'deny'].includes(expectedDecision)
      || !['tool', 'content.input', 'content.output'].includes(actionType) || !targetIdentity) return null;
    return { ruleId, expectedDecision, actionType, targetIdentity };
  }

  function activeRecord() {
    return records().map((record) => ({ record, criteria: exact(record) }))
      .find(({ criteria }) => Boolean(criteria)) || null;
  }

  function currentProjectId() {
    const fromUrl = safeText(new URLSearchParams(location.search).get('projectId'));
    if (fromUrl) return fromUrl;
    const raw = safeText(sessionStorage.getItem('arl_selected_project'));
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return safeText(parsed?.id || parsed?.projectId || parsed);
    } catch { return raw; }
  }

  async function reconcileFromServer() {
    if (reconcilePromise) return reconcilePromise;
    const projectId = currentProjectId();
    if (!projectId) return false;
    reconcilePromise = (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          credentials: 'same-origin', cache: 'no-store',
        });
        if (!response.ok) return false;
        const payload = await response.json();
        const project = payload?.project;
        if (!project || !Array.isArray(project.remediations)) return false;
        const stored = loadStored();
        let changed = false;
        for (const item of project.remediations) {
          if (item?.status !== 'ready_for_retest') continue;
          const remediationId = safeText(item.id);
          const criteriaId = safeText(item?.verification?.retestCriteriaId);
          const existing = stored[remediationId];
          // The four criteria values must already have been captured from the real
          // form. We only add the server-issued binding id here; nothing is guessed.
          if (!remediationId || !criteriaId || existing?.exactCriteriaCaptured !== true) continue;
          if (existing.criteriaId !== criteriaId || existing.projectId !== projectId) {
            stored[remediationId] = { ...existing, remediationId, projectId, criteriaId };
            changed = true;
          }
        }
        if (changed) saveStored(stored);
        return changed;
      } catch { return false; }
      finally { reconcilePromise = null; }
    })();
    return reconcilePromise;
  }

  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function mount() {
    const active = activeRecord();
    if (!active) { removePanel(); return false; }
    const root = document.getElementById('controlPlaneRoot');
    if (!root) return false;
    let panel = document.getElementById(PANEL_ID);
    const signature = `${active.record.remediationId}:${active.record.criteriaId}:${active.criteria.ruleId}:${active.criteria.expectedDecision}:${active.criteria.actionType}:${active.criteria.targetIdentity}`;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.className = 'notice info bound-retest-guidance';
      root.insertAdjacentElement('beforebegin', panel);
    }
    if (panel.dataset.signature === signature) return true;
    panel.dataset.signature = signature;
    panel.dataset.boundRetestGuidance = safeText(active.record.remediationId);
    panel.innerHTML = `<strong>Continue the active bound retest</strong><p>Verify the saved criteria, then copy the exact command.</p><p><strong>Expected:</strong> ${active.criteria.expectedDecision} · ${active.criteria.ruleId} · ${active.criteria.actionType} · <code>${active.criteria.targetIdentity}</code></p><button class="button primary small" type="button" data-copy-bound-retest="${safeText(active.record.remediationId)}">Copy bound retest command</button>`;
    return true;
  }

  async function reconcileAndMount() {
    await reconcileFromServer();
    mount();
  }

  function scheduleMount() {
    window.setTimeout(reconcileAndMount, 0);
    window.setTimeout(reconcileAndMount, 300);
    window.setTimeout(reconcileAndMount, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
  else scheduleMount();

  document.addEventListener('submit', scheduleMount, true);
  document.addEventListener('change', scheduleMount, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-remediation-status], [data-copy-bound-retest], [data-reset-bound-retest]')) scheduleMount();
  }, true);
  window.addEventListener('focus', scheduleMount);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleMount(); });

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    reconcileAndMount();
    if (attempts >= 40) window.clearInterval(timer);
  }, 500);
})();
