import { api, escapeHtml } from './shared.js';
import { buildEvidencePlan } from './evidence-plan.js';

let activeAssessmentId = '';
let serial = 0;

function selectedAssessmentId() {
  return document.querySelector('#assessmentSelect')?.value
    || new URLSearchParams(location.search).get('assessment')
    || sessionStorage.getItem('arl_selected_assessment')
    || '';
}

function gapLabel(gap = {}) {
  return gap.title || gap.name || gap.id || 'Material evidence question';
}

function checkAction(check, assessmentId) {
  const caseId = check.caseId || '';
  const params = new URLSearchParams({ assessment: assessmentId });
  if (caseId) params.set('case', caseId);
  params.set('plan', check.id);
  return `/redteam.html?${params.toString()}`;
}

function checkHtml(check, index, assessmentId) {
  return `<article class="finding-work-item" ${index === 0 ? 'data-primary-evidence-check="true"' : ''}>
    <div class="finding-work-body">
      <div class="question-meta"><span>Bounded runtime check</span><span>${escapeHtml(check.environment)}</span></div>
      <h3>${escapeHtml(check.title)}</h3>
      <p>${escapeHtml(check.why)}</p>
      <div class="plain-finding-sections">
        <div><small>Security invariant</small><p>${escapeHtml(check.invariant)}</p></div>
        <div><small>Bounded cases</small><p>${check.cases.map((item) => escapeHtml(item)).join(' · ')}</p></div>
        <div><small>Evidence question</small><p>${escapeHtml(gapLabel(check.gap))}</p></div>
      </div>
      ${check.caseId ? `<p class="microcopy">Existing controlled-test case: <code>${escapeHtml(check.caseId)}</code>. The case is a starting probe for this question; it does not by itself prove every invariant case above.</p>` : '<p class="microcopy">No existing automated case fully covers this invariant yet. Keep the question open until a bounded test is defined and approved.</p>'}
      ${check.caseId ? `<a class="button primary small" href="${checkAction(check, assessmentId)}">Open bounded check</a>` : ''}
    </div>
  </article>`;
}

function planHtml(plan, assessmentId) {
  if (plan.state === 'source-required') {
    return `<section class="workspace-section section-gap" data-evidence-plan>
      <span class="eyebrow">Evidence plan</span>
      <h2>${escapeHtml(plan.title)}</h2>
      <p>${escapeHtml(plan.explanation)}</p>
      <div class="workspace-next-action"><small>Next action</small><strong>Run the read-only source inspection.</strong><p>After source evidence returns, AgentRiskLayer will select only material runtime questions that source review cannot prove.</p></div>
    </section>`;
  }

  if (plan.state === 'bounded-check-required') {
    return `<section class="workspace-section section-gap" data-evidence-plan>
      <div class="workspace-section-heading"><div><span class="eyebrow">Evidence plan</span><h2>${escapeHtml(plan.checks.length === 1 ? '1 bounded runtime check selected' : `${plan.checks.length} bounded runtime checks selected`)}</h2><p>${escapeHtml(plan.explanation)}</p></div></div>
      <div class="success-box"><strong>Source evidence complete.</strong><p>Inspector observations are technical evidence for review, not automatically confirmed vulnerabilities. Run only the bounded checks needed for material questions source review cannot prove.</p></div>
      <div class="notice"><strong>Run only what is needed.</strong> These checks are derived from material evidence gaps. AgentRiskLayer does not automatically turn unmapped questions into findings or generic attack tests.</div>
      <div class="plain-finding-list">${plan.checks.map((check, index) => checkHtml(check, index, assessmentId)).join('')}</div>
      ${plan.manual.length ? `<details class="workspace-technical section-gap"><summary><span>${plan.manual.length} other evidence question${plan.manual.length === 1 ? '' : 's'}</span><small>No safe automatic bounded test selected</small></summary><div class="workspace-technical-body"><ul class="check-list">${plan.manual.map((gap) => `<li>${escapeHtml(gapLabel(gap))}</li>`).join('')}</ul><p class="microcopy">These remain material evidence gaps until appropriate evidence or a reviewer-defined bounded test is available.</p></div></details>` : ''}
    </section>`;
  }

  return `<section class="workspace-section section-gap" data-evidence-plan>
    <span class="eyebrow">Evidence plan</span>
    <h2>${escapeHtml(plan.title)}</h2>
    <p>${escapeHtml(plan.explanation)}</p>
    <div class="success-box"><strong>Source evidence complete.</strong><p>Inspector observations remain observed static evidence. They become confirmed findings only when the evidence chain supports that conclusion; unresolved questions remain open.</p></div>
    ${plan.manual.length ? `<ul class="check-list">${plan.manual.map((gap) => `<li>${escapeHtml(gapLabel(gap))}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function insertPlan(html, attempt = 0) {
  const targetPanel = document.querySelector('[data-inspector-target-panel]');
  const command = document.querySelector('.workspace-agent-command');
  const anchor = targetPanel || command;
  if (!anchor) {
    if (attempt < 20) setTimeout(() => insertPlan(html, attempt + 1), 100);
    return;
  }
  document.querySelector('[data-evidence-plan]')?.remove();
  anchor.insertAdjacentHTML('afterend', html);
}

async function loadPlan(assessmentId) {
  if (!assessmentId) return;
  const requestSerial = ++serial;
  activeAssessmentId = assessmentId;
  try {
    const [assessmentPayload, inspectionPayload] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}`),
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`),
    ]);
    if (requestSerial !== serial || activeAssessmentId !== assessmentId) return;
    const inspections = [...(inspectionPayload.inspections || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const plan = buildEvidencePlan({ assessment: assessmentPayload.assessment || {}, inspections });
    insertPlan(planHtml(plan, assessmentId));
  } catch (error) {
    if (requestSerial !== serial || activeAssessmentId !== assessmentId) return;
    insertPlan(`<section class="workspace-section section-gap" data-evidence-plan><span class="eyebrow">Evidence plan</span><h2>Evidence plan unavailable</h2><p>${escapeHtml(error.message)}</p></section>`);
  }
}

function sync() {
  const assessmentId = selectedAssessmentId();
  if (!assessmentId) return;
  if (assessmentId === activeAssessmentId && document.querySelector('[data-evidence-plan]')) return;
  loadPlan(assessmentId);
}

const observer = new MutationObserver(() => {
  const assessmentId = selectedAssessmentId();
  if (!assessmentId) return;
  if (assessmentId !== activeAssessmentId || !document.querySelector('[data-evidence-plan]')) loadPlan(assessmentId);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('change', (event) => {
  if (event.target?.id !== 'assessmentSelect') return;
  activeAssessmentId = '';
  serial += 1;
  queueMicrotask(sync);
});

document.addEventListener('click', (event) => {
  if (event.target?.id !== 'refreshScans') return;
  const assessmentId = selectedAssessmentId();
  if (!assessmentId) return;
  activeAssessmentId = '';
  setTimeout(() => loadPlan(assessmentId), 300);
});

document.addEventListener('arl:source-evidence-recorded', (event) => {
  const assessmentId = event.detail?.assessmentId || selectedAssessmentId();
  if (!assessmentId) return;
  activeAssessmentId = '';
  serial += 1;
  setTimeout(() => loadPlan(assessmentId), 100);
});

sync();
