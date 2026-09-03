import { escapeHtml } from './shared.js';
import { evidencePlanCatalog } from './evidence-plan.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const requestedCase = String(params.get('case') || '').trim().toUpperCase();
const planId = String(params.get('plan') || '').trim();

function selectedPlan() {
  if (!planId) return null;
  return evidencePlanCatalog().find((item) => item.id === planId) || null;
}

function contextIsValid(plan) {
  if (!plan || !assessmentId || !requestedCase) return false;
  return plan.caseId === requestedCase;
}

function contextBanner(plan) {
  const existing = document.querySelector('[data-bounded-evidence-context]');
  if (existing) return existing;
  const setup = document.querySelector('#redteamRoot .panel');
  if (!setup) return null;
  const section = document.createElement('section');
  section.dataset.boundedEvidenceContext = 'true';
  section.className = 'workspace-section section-gap';
  section.innerHTML = `<span class="eyebrow">Evidence plan</span>
    <h2>${escapeHtml(plan.title)}</h2>
    <p>${escapeHtml(plan.why)}</p>
    <div class="plain-finding-sections">
      <div><small>Security invariant</small><p>${escapeHtml(plan.invariant)}</p></div>
      <div><small>Selected starting probe</small><p><code>${escapeHtml(plan.caseId)}</code></p></div>
      <div><small>Bounded cases to prove</small><p>${plan.cases.map((item) => escapeHtml(item)).join(' · ')}</p></div>
    </div>
    <div class="notice"><strong>This is a bounded evidence run.</strong> The selected Red Team case is a starting probe. Passing it does not close the evidence question unless the required invariant cases are supported by retest evidence.</div>
    <a class="button ghost small" href="/inspector.html?assessment=${encodeURIComponent(assessmentId)}">Back to evidence plan</a>`;
  setup.insertAdjacentElement('afterbegin', section);
  return section;
}

function applyContext() {
  const plan = selectedPlan();
  if (!contextIsValid(plan)) return false;

  const assessmentSelect = document.querySelector('#assessmentSelect');
  const caseInput = document.querySelector('#caseId');
  const adapterMode = document.querySelector('input[name="mode"][value="adapter"]');
  const simulationMode = document.querySelector('input[name="mode"][value="simulation"]');
  const adapterFields = document.querySelector('#adapterFields');
  if (!assessmentSelect || !caseInput || !adapterMode || !simulationMode || !adapterFields) return false;

  if (![...assessmentSelect.options].some((option) => option.value === assessmentId)) return false;
  if (assessmentSelect.value !== assessmentId) {
    assessmentSelect.value = assessmentId;
    assessmentSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  caseInput.value = plan.caseId;
  caseInput.readOnly = true;
  caseInput.setAttribute('aria-readonly', 'true');
  caseInput.title = 'Selected by the AgentRiskLayer evidence plan. Return to the evidence plan to choose a different justified check.';

  adapterMode.checked = true;
  simulationMode.checked = false;
  adapterFields.hidden = false;
  adapterMode.dispatchEvent(new Event('change', { bubbles: true }));

  const trials = document.querySelector('#trials');
  if (trials && [...trials.options].some((option) => option.value === '3')) trials.value = '3';

  const button = document.querySelector('#createCampaign');
  if (button) button.textContent = 'Create bounded evidence command';

  const field = caseInput.closest('.field');
  if (field) {
    const help = field.querySelector('.microcopy');
    if (help) help.textContent = 'Selected from the material evidence plan. This case is locked here so the controlled run cannot silently broaden into the full catalogue.';
  }

  contextBanner(plan);
  return true;
}

if (assessmentId && requestedCase && planId) {
  const observer = new MutationObserver(() => {
    if (applyContext()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  applyContext();
}
