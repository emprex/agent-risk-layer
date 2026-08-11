import { api, qs } from './shared.js';

const projectId = qs('projectId');
const controlId = qs('controlId');
const page = location.pathname.split('/').pop();
const isControlPage = page === 'control-intelligence-control.html';
const isOverviewPage = page === 'control-intelligence.html';

const stageLabels = Object.freeze({
  applicability: '1. Applicability',
  test: '2. Test',
  evidence: '3. Evidence',
  finding: '4. Finding',
  remediation: '5. Remediation & implementation',
  retest: '6. Exact retest & closure',
  approval: '7. Approval',
  deployment_decision: '8. Deployment decision',
});

const stageHelp = Object.freeze({
  applicability: 'Decide whether this control applies to this exact system snapshot.',
  test: 'Record the bounded test and what actually happened.',
  evidence: 'Attach evidence that supports the recorded result. Evidence trust remains explicit.',
  finding: 'Create a finding only for an observed or reproduced failure.',
  remediation: 'Plan the fix, record implementation evidence, then create a changed snapshot.',
  retest: 'Repeat the exact failure against the changed version before closure.',
  approval: 'Bind any required human approval to the exact action and scope.',
  deployment_decision: 'Use the complete evidence chain to calculate the project decision.',
});

const normaliseState = (value) => String(value || '').trim().toLowerCase().replaceAll(' ', '_');
const text = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

function messageBox() {
  return document.querySelector('#ciMessage');
}

function setMessage(value, error = false) {
  const box = messageBox();
  if (!box) return;
  box.className = error ? 'error-box show' : 'success-box show';
  box.textContent = value;
  box.setAttribute('tabindex', '-1');
  box.focus({ preventScroll: true });
}

function addFormGuidance() {
  const applicability = document.querySelector('#applicabilityForm');
  if (applicability && !applicability.querySelector('[data-ux-fact-help]')) {
    const factLegend = [...applicability.querySelectorAll('legend')].find((node) => node.textContent.includes('Architecture facts'));
    if (factLegend) {
      const help = text('p', 'ci-field-help', 'Select only facts that genuinely support this decision. Do not choose an unrelated fact just to satisfy the form. If the architecture is genuinely unknown, use “More information required” and state exactly what is missing.');
      help.dataset.uxFactHelp = 'true';
      factLegend.insertAdjacentElement('afterend', help);
    }
  }

  const impact = document.querySelector('#findingForm fieldset:last-of-type');
  if (impact && !impact.querySelector('[data-ux-impact-help]')) {
    const help = text('p', 'ci-field-help', 'Select only impacts demonstrated by evidence. Potential but untested impacts belong in the impact narrative or limitations.');
    help.dataset.uxImpactHelp = 'true';
    impact.querySelector('legend')?.insertAdjacentElement('afterend', help);
  }

  const remediationOwner = document.querySelector('label:has(#remediationOwner)');
  if (remediationOwner) {
    const first = remediationOwner.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = 'Responsible owner email';
  }
}

function decorateRiskContext() {
  const root = document.querySelector('#ciControlRoot');
  const riskPanel = root?.querySelector('.ci-next + .panel');
  if (!riskPanel || riskPanel.querySelector('.ci-context-details')) return;
  const supporting = [...riskPanel.children].filter((node) => node.tagName === 'P' && /^(Why suggested:|Architecture facts:)/.test(node.textContent.trim()));
  if (!supporting.length) return;
  const details = document.createElement('details');
  details.className = 'ci-context-details';
  details.append(text('summary', '', 'Why this control was suggested'));
  supporting[0].insertAdjacentElement('beforebegin', details);
  supporting.forEach((node) => details.append(node));
}

function buildStageNavigator(stages) {
  const journey = document.querySelector('.ci-journey');
  if (!journey) return;
  journey.previousElementSibling?.classList.contains('ci-stage-nav') && journey.previousElementSibling.remove();
  const nav = document.createElement('nav');
  nav.className = 'ci-stage-nav';
  nav.setAttribute('aria-label', 'Control assessment progress');
  const list = document.createElement('ol');
  for (const stage of stages) {
    const key = stage.dataset.stage;
    const state = stage.dataset.uxState;
    const item = document.createElement('li');
    item.dataset.state = state;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ci-stage-link';
    button.disabled = state === 'blocked';
    button.setAttribute('aria-current', state === 'current' ? 'step' : 'false');
    button.append(text('span', 'ci-stage-link-title', stageLabels[key] || key));
    button.append(text('small', 'ci-stage-link-state', state.replaceAll('_', ' ')));
    button.addEventListener('click', () => {
      if (state === 'blocked') return;
      stage.open = true;
      stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stage.querySelector('summary')?.focus({ preventScroll: true });
    });
    item.append(button);
    list.append(item);
  }
  nav.append(list);
  journey.insertAdjacentElement('beforebegin', nav);
}

function decorateJourney() {
  const root = document.querySelector('#ciControlRoot');
  if (!root || root.classList.contains('loading')) return;
  const next = root.querySelector('.ci-next');
  if (next) {
    const p = next.querySelector('p');
    if (p) p.textContent = 'Complete only the highlighted step. Later stages unlock from saved evidence; completed evidence remains historical.';
  }

  const stages = [...root.querySelectorAll('.ci-journey-stage')];
  if (!stages.length) return;
  for (const stage of stages) {
    if (stage.dataset.uxDecorated === 'true') continue;
    const key = stage.dataset.stage;
    const summary = stage.querySelector(':scope > summary');
    const stateNode = summary?.querySelector('strong');
    const state = normaliseState(stateNode?.textContent);
    stage.dataset.uxState = state;
    stage.dataset.uxDecorated = 'true';
    stage.classList.add(`ci-state-${state}`);
    const titleNode = summary?.querySelector('span');
    if (titleNode) titleNode.textContent = stageLabels[key] || titleNode.textContent;
    if (stateNode) stateNode.textContent = state.replaceAll('_', ' ');
    if (summary && !summary.querySelector('.ci-stage-help')) {
      summary.insertAdjacentElement('afterend', text('p', 'ci-stage-help', stageHelp[key] || ''));
    }
    if (state === 'current') stage.open = true;
    else stage.open = false;
  }
  buildStageNavigator(stages);
  root.querySelectorAll('.ci-form').forEach((form) => form.classList.add('ci-form-card'));
  decorateRiskContext();
  addFormGuidance();
}

function wrapSubstep(form, { title: label, status, open, locked, note }) {
  if (!form || form.closest('.ci-substep')) return;
  const wrapper = document.createElement('details');
  wrapper.className = `ci-substep ci-substep-${status}${locked ? ' is-locked' : ''}`;
  wrapper.open = Boolean(open && !locked);
  const summary = document.createElement('summary');
  summary.append(text('span', '', label));
  summary.append(text('strong', '', status));
  wrapper.append(summary);
  if (note) wrapper.append(text('p', 'ci-substep-note', note));
  form.insertAdjacentElement('beforebegin', wrapper);
  wrapper.append(form);
  if (locked || status === 'saved' || status === 'complete') {
    form.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
  }
}

let remediationProbeRunning = false;
async function decorateRemediationProgress() {
  if (!isControlPage || remediationProbeRunning || !projectId || !controlId) return;
  const root = document.querySelector('#ciControlRoot');
  const remediationStage = root?.querySelector('[data-stage="remediation"]');
  if (!remediationStage || remediationStage.dataset.uxRemediation === 'true') return;
  remediationStage.dataset.uxRemediation = 'true';
  remediationProbeRunning = true;
  try {
    const detail = await api(`/api/projects/${encodeURIComponent(projectId)}/control-intelligence/controls/${encodeURIComponent(controlId)}`);
    const finding = detail.findings?.[0];
    if (!finding) return;
    let remediation = null;
    try {
      const list = await api(`/api/projects/${encodeURIComponent(projectId)}/remediations`);
      remediation = list.remediations?.find((item) => item.id === finding.id) || null;
    } catch {
      remediation = null;
    }
    const verification = remediation?.verification || {};
    const planSaved = Boolean(verification.rootCause || verification.correctiveAction || verification.validationPlan);
    const implementationSaved = Boolean(verification.artifactId);
    const failed = (detail.testHistory || detail.tests || []).find((item) => item.result === 'failed' && item.executionKind !== 'retest');
    const changedSnapshot = Boolean(failed?.systemSnapshotId && detail.systemSnapshot?.id && failed.systemSnapshotId !== detail.systemSnapshot.id);

    wrapSubstep(document.querySelector('#remediationForm'), {
      title: '1. Remediation plan',
      status: planSaved ? 'saved' : 'current',
      open: !planSaved,
      locked: planSaved,
      note: planSaved ? 'Plan saved. Existing remediation evidence is retained; implementation must now reference the actual change.' : 'Define the root cause, corrective action, rollback and validation before recording implementation evidence.',
    });
    wrapSubstep(document.querySelector('#implementationForm'), {
      title: '2. Implementation evidence',
      status: implementationSaved ? 'saved' : planSaved ? 'current' : 'locked',
      open: planSaved && !implementationSaved,
      locked: !planSaved || implementationSaved,
      note: !planSaved ? 'Available after the remediation plan is saved.' : implementationSaved ? 'Implementation evidence recorded. Create a changed snapshot only for the version that actually contains the fix.' : 'Record the exact change reference, changed version and what was implemented. Do not record planned work as implemented.',
    });
    wrapSubstep(document.querySelector('#snapshotForm'), {
      title: '3. Remediated snapshot',
      status: changedSnapshot ? 'complete' : implementationSaved ? 'current' : 'locked',
      open: implementationSaved && !changedSnapshot,
      locked: !implementationSaved || changedSnapshot,
      note: !implementationSaved ? 'Available after implementation evidence is recorded.' : changedSnapshot ? 'A changed system snapshot exists. Continue to the exact retest stage.' : 'Create a new immutable snapshot only after confirming this exact system version contains the implemented remediation.',
    });
  } finally {
    remediationProbeRunning = false;
  }
}

function decorateOverview() {
  if (!isOverviewPage) return;
  const currentView = qs('view') || 'overview';
  const controlsPanel = document.querySelector('#controls');
  if (currentView === 'overview' && controlsPanel && controlsPanel.dataset.uxPreview !== 'true') {
    controlsPanel.dataset.uxPreview = 'true';
    const heading = controlsPanel.querySelector('h2');
    if (heading) heading.textContent = 'Controls requiring attention';
    const list = controlsPanel.querySelector('.ci-control-list');
    const note = text('p', 'ci-preview-note', 'This overview shows the first controls requiring attention. Open the Controls view for the complete catalogue, batch review and filters.');
    list?.insertAdjacentElement('beforebegin', note);
    controlsPanel.querySelector('.ci-bulk-actions')?.classList.add('ci-overview-hidden');
    controlsPanel.querySelectorAll('[data-bulk-control]').forEach((box) => box.closest('label')?.classList.add('ci-overview-hidden'));
    const loadMore = controlsPanel.querySelector('#loadMore');
    if (loadMore) {
      const link = document.createElement('a');
      link.className = 'button primary';
      link.href = `/control-intelligence.html?projectId=${encodeURIComponent(projectId || '')}&view=controls`;
      link.textContent = 'View all controls';
      loadMore.replaceWith(link);
    } else if (projectId) {
      controlsPanel.append(Object.assign(document.createElement('a'), {
        className: 'button primary ci-view-all-controls',
        href: `/control-intelligence.html?projectId=${encodeURIComponent(projectId)}&view=controls`,
        textContent: 'View all controls',
      }));
    }
  }

  if (currentView === 'controls') {
    const bulk = document.querySelector('#bulkReview');
    if (bulk && !bulk.dataset.uxBulkCopy) {
      bulk.dataset.uxBulkCopy = 'true';
      const intro = bulk.querySelector('h2 + p');
      if (intro) intro.textContent = 'Every row needs its own decision and reason. The browser saves each control independently, so one invalid or stale row no longer discards successful decisions.';
    }
  }
}

function markBulkRow(row, status, detail = '') {
  row.classList.remove('ci-bulk-row-saved', 'ci-bulk-row-error');
  row.classList.add(status === 'saved' ? 'ci-bulk-row-saved' : 'ci-bulk-row-error');
  row.querySelector(':scope > .ci-inline-result')?.remove();
  const result = text('p', 'ci-inline-result', status === 'saved' ? 'Saved.' : `Not saved: ${detail}`);
  row.append(result);
}

async function saveBulkIndependently(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'bulkForm' || !projectId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  const rows = [...form.querySelectorAll('[data-bulk-row]')];
  let saved = 0;
  const failures = [];
  try {
    const current = await api(`/api/projects/${encodeURIComponent(projectId)}/control-intelligence?limit=1`);
    const snapshotId = current.systemSnapshot?.id;
    if (!snapshotId) throw new Error('Current system snapshot is unavailable. Reload before saving.');
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const control = row.dataset.bulkRow;
      const decision = form.elements[`decision-${index}`]?.value;
      const baseReason = String(form.elements[`reason-${index}`]?.value || '').trim();
      const missing = String(form.elements[`missing-${index}`]?.value || '').trim();
      const reason = decision === 'context_required' && missing ? `${baseReason} Missing information: ${missing}` : baseReason;
      const architectureFactIds = [...row.querySelectorAll(`[name="fact-${index}"]:checked`)].map((node) => node.value);
      const expectedEvaluationDigest = form.elements[`digest-${index}`]?.value;
      try {
        if (decision === 'context_required' && missing.length < 10) throw new Error('Describe the missing architecture information in at least 10 characters.');
        await api(`/api/projects/${encodeURIComponent(projectId)}/control-intelligence/controls/${encodeURIComponent(control)}/applicability`, {
          method: 'POST',
          body: JSON.stringify({ snapshotId, decision, reason, architectureFactIds, expectedEvaluationDigest }),
        });
        saved += 1;
        markBulkRow(row, 'saved');
        row.querySelectorAll('input, textarea, select, button').forEach((controlNode) => { controlNode.disabled = true; });
      } catch (error) {
        failures.push({ control, message: error.message });
        markBulkRow(row, 'error', error.message);
      }
    }
    if (!failures.length) {
      setMessage(`Saved ${saved} individual applicability decisions. Reloading the updated assessment…`);
      setTimeout(() => location.reload(), 500);
    } else {
      setMessage(`Saved ${saved} decision${saved === 1 ? '' : 's'}. ${failures.length} row${failures.length === 1 ? '' : 's'} still need attention; successful rows were not rolled back.`, true);
      failures[0] && rows.find((row) => row.dataset.bulkRow === failures[0].control)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('submit', saveBulkIndependently, true);

let scheduled = false;
function enhance() {
  scheduled = false;
  if (isControlPage) {
    decorateJourney();
    decorateRemediationProgress().catch(() => null);
  }
  if (isOverviewPage) decorateOverview();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhance);
}

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, { subtree: true, childList: true });
window.addEventListener('pageshow', scheduleEnhance);
scheduleEnhance();
