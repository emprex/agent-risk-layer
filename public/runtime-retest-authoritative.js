// Recover the exact active remediation retest criteria from server-owned project state.
// This removes the browser-session dependency that previously forced users to reset
// valid criteria after refresh. Only an audit event whose target id equals the active
// server-issued criteria id is accepted; no title- or target-based inference is used.
(() => {
  const STORAGE_KEY = 'arl_runtime_retest_workflow_v1';

  function text(value) { return String(value ?? '').trim(); }

  function projectId() {
    const fromUrl = text(new URLSearchParams(location.search).get('projectId'));
    if (fromUrl) return fromUrl;
    return text(sessionStorage.getItem('arl_selected_project'));
  }

  function loadStored() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveStored(value) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }

  function exactMetadata(metadata) {
    const ruleId = text(metadata?.ruleId).toUpperCase();
    const expectedDecision = text(metadata?.expectedDecision).toLowerCase();
    const actionType = text(metadata?.actionType).toLowerCase();
    const targetIdentity = text(metadata?.targetIdentity).toLowerCase();
    if (!ruleId || !['allow', 'deny'].includes(expectedDecision)
      || !['tool', 'content.input', 'content.output'].includes(actionType) || !targetIdentity) return null;
    return { ruleId, expectedDecision, actionType, targetIdentity };
  }

  function matchingAudit(project, criteriaId, remediationId) {
    return (Array.isArray(project?.audit) ? project.audit : []).find((event) => {
      if (event?.action !== 'remediation.retest_criteria_created') return false;
      if (text(event?.target_id) !== criteriaId) return false;
      if (text(event?.metadata?.remediationId) !== remediationId) return false;
      return Boolean(exactMetadata(event?.metadata));
    }) || null;
  }

  function clearStaleResetPanel(remediationId) {
    const row = document.querySelector(`[data-remediation-id="${CSS.escape(remediationId)}"]`);
    const panel = row?.querySelector('[data-bound-retest-guidance]');
    if (panel?.querySelector('[data-reset-bound-retest]')) panel.remove();
  }

  async function recover() {
    const id = projectId();
    if (!id) return false;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
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
        const remediationId = text(item.id);
        const criteriaId = text(item?.verification?.retestCriteriaId);
        if (!remediationId || !criteriaId) continue;

        const audit = matchingAudit(project, criteriaId, remediationId);
        const criteria = exactMetadata(audit?.metadata);
        if (!criteria) continue;

        const previous = stored[remediationId] || {};
        stored[remediationId] = {
          ...previous,
          remediationId,
          projectId: id,
          criteriaId,
          ...criteria,
          exactCriteriaCaptured: true,
          criteriaSource: 'server-audit',
          criteriaAuditId: text(audit.id),
        };
        changed = true;
        clearStaleResetPanel(remediationId);
      }
      if (changed) {
        saveStored(stored);
        // Existing retest helpers reconcile/render on change/focus; this event makes
        // the update immediate without creating another DOM observer.
        document.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return changed;
    } catch {
      return false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recover, { once: true });
  else recover();

  document.addEventListener('submit', () => setTimeout(recover, 150), true);
  window.addEventListener('focus', recover);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recover(); });
})();
