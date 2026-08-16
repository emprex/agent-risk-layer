// Surface the next remediation action from server-owned evidence instead of hiding it
// in a lifecycle dropdown. The backend remains authoritative for the transition.
(() => {
  const PANEL_ID = 'arlPassedRetestAction';
  let busy = false;

  function text(value) { return String(value ?? '').trim(); }

  function currentProjectId() {
    const fromUrl = text(new URLSearchParams(location.search).get('projectId'));
    return fromUrl || text(sessionStorage.getItem('arl_selected_project'));
  }

  function matchingPassedExecution(project, item) {
    const criteriaId = text(item?.verification?.retestCriteriaId);
    const remediationId = text(item?.id);
    if (!criteriaId || !remediationId || item?.status !== 'ready_for_retest') return null;

    const audit = (Array.isArray(project?.audit) ? project.audit : []).find((event) =>
      event?.action === 'remediation.retest_executed'
      && text(event?.target_id) === criteriaId
      && text(event?.metadata?.remediationId) === remediationId
      && text(event?.metadata?.result).toLowerCase() === 'passed'
      && text(event?.metadata?.runtimeEventId));
    if (!audit) return null;

    const runtimeEventId = text(audit.metadata.runtimeEventId);
    const runtimeEvent = (Array.isArray(project?.events) ? project.events : []).find((event) =>
      text(event?.id) === runtimeEventId
      && text(event?.retest_criteria_id) === criteriaId
      && text(event?.remediation_id) === remediationId
      && Boolean(event?.retest_satisfied));
    if (!runtimeEvent) return null;

    return { criteriaId, remediationId, runtimeEventId, auditId: text(audit.id) };
  }

  function hideCompletedRunGuidance(remediationId) {
    document.querySelectorAll('[data-bound-retest-guidance]').forEach((panel) => {
      if (text(panel.dataset.boundRetestGuidance) === remediationId) panel.hidden = true;
    });
  }

  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function mount(project, item, execution) {
    const root = document.getElementById('controlPlaneRoot');
    if (!root) return;
    hideCompletedRunGuidance(execution.remediationId);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.className = 'notice success';
      root.insertAdjacentElement('beforebegin', panel);
    }
    panel.dataset.remediationId = execution.remediationId;
    panel.dataset.criteriaId = execution.criteriaId;
    panel.innerHTML = `<strong>Bound retest passed — record it now</strong><p>AgentRiskLayer has server evidence that criteria <code>${execution.criteriaId}</code> passed. Record this passed retest to attach the verified retest artifact and continue to closure.</p><button class="button primary" type="button" data-record-passed-retest>Record passed retest</button><p class="error-box" data-record-passed-retest-error hidden></p>`;
    panel.querySelector('[data-record-passed-retest]')?.addEventListener('click', () => record(project.id, execution));
  }

  async function record(projectId, execution) {
    if (busy) return;
    const panel = document.getElementById(PANEL_ID);
    const button = panel?.querySelector('[data-record-passed-retest]');
    const errorBox = panel?.querySelector('[data-record-passed-retest-error]');
    busy = true;
    if (button) { button.disabled = true; button.textContent = 'Recording passed retest…'; }
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    try {
      const { api } = await import('./shared.js');
      await api(`/api/projects/${encodeURIComponent(projectId)}/remediations/${encodeURIComponent(execution.remediationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'retested' }),
      });
      location.hash = 'remediation';
      location.reload();
    } catch (error) {
      busy = false;
      if (button) { button.disabled = false; button.textContent = 'Record passed retest'; }
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.classList.add('show');
        errorBox.textContent = error?.message || 'Could not record the passed retest.';
      }
    }
  }

  async function reconcile() {
    const projectId = currentProjectId();
    if (!projectId || busy) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const project = payload?.project;
      const candidate = (Array.isArray(project?.remediations) ? project.remediations : [])
        .map((item) => ({ item, execution: matchingPassedExecution(project, item) }))
        .find(({ execution }) => Boolean(execution));
      if (!candidate) { removePanel(); return; }
      mount(project, candidate.item, candidate.execution);
    } catch {
      // This helper only surfaces an action. It must never change evidence on fetch failure.
    }
  }

  function schedule() {
    window.setTimeout(reconcile, 0);
    window.setTimeout(reconcile, 400);
    window.setTimeout(reconcile, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  window.addEventListener('focus', reconcile);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcile(); });
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    reconcile();
    if (attempts >= 30) window.clearInterval(timer);
  }, 1000);
})();
