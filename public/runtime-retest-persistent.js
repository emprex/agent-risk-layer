// Keep the bound-retest action outside the dynamic Runtime application root so
// ordinary project re-renders cannot make the action disappear.
(() => {
  const STORAGE_KEY = 'arl_runtime_retest_workflow_v1';
  const PANEL_ID = 'arlPersistentBoundRetest';

  function safeText(value) { return String(value ?? '').trim(); }

  function records() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {};
      return Object.values(value);
    } catch {
      return [];
    }
  }

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

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function mount() {
    const active = activeRecord();
    if (!active) {
      removePanel();
      return false;
    }
    const root = document.getElementById('controlPlaneRoot');
    if (!root) return false;
    let panel = document.getElementById(PANEL_ID);
    const signature = `${active.record.remediationId}:${active.record.criteriaId}:${active.criteria.ruleId}:${active.criteria.expectedDecision}:${active.criteria.actionType}:${active.criteria.targetIdentity}`;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.className = 'notice info bound-retest-guidance';
      panel.dataset.boundRetestGuidance = safeText(active.record.remediationId);
      root.insertAdjacentElement('beforebegin', panel);
    }
    if (panel.dataset.signature === signature) return true;
    panel.dataset.signature = signature;
    panel.dataset.boundRetestGuidance = safeText(active.record.remediationId);
    panel.innerHTML = `<strong>Continue the active bound retest</strong><p>This action is kept outside the live project panel so it cannot disappear when Runtime refreshes. Verify the saved criteria, then copy the exact command.</p><p><strong>Expected:</strong> ${active.criteria.expectedDecision} · ${active.criteria.ruleId} · ${active.criteria.actionType} · <code>${active.criteria.targetIdentity}</code></p><button class="button primary small" type="button" data-copy-bound-retest="${safeText(active.record.remediationId)}">Copy bound retest command</button>`;
    return true;
  }

  function scheduleMount() {
    window.setTimeout(mount, 0);
    window.setTimeout(mount, 250);
    window.setTimeout(mount, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
  else scheduleMount();

  // Criteria are captured during the real form submission and the server criteria
  // ID arrives in the following project response. Re-check around those actions.
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
    mount();
    if (attempts >= 80) window.clearInterval(timer);
  }, 250);
})();
