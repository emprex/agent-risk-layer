import { api, escapeHtml } from './shared.js';
import { evidencePlanCatalog } from './evidence-plan.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const requestedCase = String(params.get('case') || '').trim().toUpperCase();
const planId = String(params.get('plan') || '').trim();
const retestRequested = params.get('retest') === '1';
const baselineRunId = String(params.get('baseline') || '').trim();
const requestedRoe = String(params.get('roe') || '').trim();
let retestState = null;
let retestStatePromise = null;

function selectedPlan() {
  if (!planId) return null;
  return evidencePlanCatalog().find((item) => item.id === planId) || null;
}

function contextIsValid(plan) {
  if (!plan || !assessmentId || !requestedCase) return false;
  return plan.caseId === requestedCase;
}

async function loadRetestState() {
  if (!retestRequested) return null;
  if (!retestStatePromise) {
    retestStatePromise = (async () => {
      if (!baselineRunId || !requestedRoe) return { valid: false, reason: 'Exact retest context is missing the failed baseline or Rules of Engagement identity.' };
      try {
        const [{ run }, { authorisations = [] }] = await Promise.all([
          api(`/api/redteam/runs/${encodeURIComponent(baselineRunId)}`),
          api(`/api/assessments/${encodeURIComponent(assessmentId)}/redteam/authorisations`),
        ]);
        if (!run || run.assessmentId !== assessmentId) return { valid: false, reason: 'The requested failed baseline is not bound to this assessment.' };
        if (run.authorisationId !== requestedRoe) return { valid: false, reason: 'The requested Rules of Engagement does not match the failed baseline.' };
        const failed = (run.results || []).some((item) => String(item.caseId || '').toUpperCase() === requestedCase && item.outcome === 'failed');
        if (!failed) return { valid: false, reason: 'The selected baseline does not contain a reproduced failure for this bounded case.' };
        const authorisation = authorisations.find((item) => item.id === requestedRoe);
        if (!authorisation) return { valid: false, reason: 'The Rules of Engagement used for the failed baseline is no longer available.' };
        const active = authorisation.status === 'active' && Date.parse(authorisation.windowEnd || '') > Date.now();
        if (!active) return { valid: false, reason: 'The original Rules of Engagement is expired or revoked. Exact retest lineage cannot be preserved by silently creating a new authorisation.' };
        return { valid: true, run, authorisation };
      } catch (error) {
        return { valid: false, reason: error.message };
      }
    })();
  }
  retestState = await retestStatePromise;
  return retestState;
}

function contextBanner(plan) {
  const existing = document.querySelector('[data-bounded-evidence-context]');
  if (existing) return existing;
  const setup = document.querySelector('#redteamRoot .panel');
  if (!setup) return null;
  const section = document.createElement('section');
  section.dataset.boundedEvidenceContext = 'true';
  section.className = 'workspace-section section-gap';
  section.innerHTML = `<span class="eyebrow">${retestRequested ? 'Exact retest' : 'Evidence plan'}</span>
    <h2>${escapeHtml(plan.title)}</h2>
    <p>${escapeHtml(plan.why)}</p>
    <div class="plain-finding-sections">
      <div><small>Security invariant</small><p>${escapeHtml(plan.invariant)}</p></div>
      <div><small>Selected starting probe</small><p><code>${escapeHtml(plan.caseId)}</code></p></div>
      <div><small>Bounded cases to prove</small><p>${plan.cases.map((item) => escapeHtml(item)).join(' · ')}</p></div>
      ${retestRequested && baselineRunId ? `<div><small>Failed baseline</small><p><code>${escapeHtml(baselineRunId)}</code></p></div>` : ''}
    </div>
    <div class="notice"><strong>${retestRequested ? 'Preserve the baseline conditions.' : 'This is a bounded evidence run.'}</strong> ${retestRequested ? 'The same case, active Rules of Engagement, authorised target, policy version and request fingerprint are required for exact comparison.' : 'The selected Red Team case is a starting probe. Passing it does not close the evidence question unless the required invariant cases are supported by retest evidence.'}</div>
    <a class="button ghost small" href="/inspector.html?assessment=${encodeURIComponent(assessmentId)}">Back to evidence plan</a>`;
  setup.insertAdjacentElement('afterbegin', section);
  return section;
}

function showRetestBlock(reason) {
  const setup = document.querySelector('#redteamRoot .panel');
  if (!setup || setup.querySelector('[data-exact-retest-blocked]')) return;
  const warning = document.createElement('section');
  warning.dataset.exactRetestBlocked = 'true';
  warning.className = 'workspace-section section-gap';
  warning.innerHTML = `<span class="eyebrow">Exact retest unavailable</span><h2>Do not silently change the test lineage</h2><p>${escapeHtml(reason)}</p><p class="microcopy">Return to the Evidence Plan and record the limitation or define a new bounded test. A new Rules of Engagement would be new evidence, not the exact retest of this baseline.</p><a class="button primary small" href="/inspector.html?assessment=${encodeURIComponent(assessmentId)}">Return to Evidence Plan</a>`;
  setup.insertAdjacentElement('afterbegin', warning);
  const create = document.querySelector('#createCampaign');
  if (create) create.disabled = true;
}

function selectRoe(authorisationId) {
  const select = document.querySelector('#authorisationChoice');
  if (!select) return false;
  if (![...select.options].some((option) => option.value === authorisationId)) return false;
  if (select.value !== authorisationId) {
    select.value = authorisationId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  select.disabled = true;
  select.title = 'Locked to the Rules of Engagement used by the failed baseline so exact retest provenance is preserved.';
  return true;
}

async function applyContext() {
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
  if (button) button.textContent = retestRequested ? 'Create exact retest command' : 'Create bounded evidence command';

  const field = caseInput.closest('.field');
  if (field) {
    const help = field.querySelector('.microcopy');
    if (help) help.textContent = retestRequested
      ? 'Locked to the exact case used by the failed baseline. Do not broaden the catalogue during an exact retest.'
      : 'Selected from the material evidence plan. This case is locked here so the controlled run cannot silently broaden into the full catalogue.';
  }

  contextBanner(plan);

  if (retestRequested) {
    const state = retestState || await loadRetestState();
    if (!state?.valid) {
      showRetestBlock(state?.reason || 'Exact retest context could not be verified.');
      return true;
    }
    if (!selectRoe(state.authorisation.id)) return false;
    const banner = document.querySelector('[data-bounded-evidence-context] .notice');
    if (banner) banner.insertAdjacentHTML('afterend', `<div class="success-box"><strong>Exact lineage preserved.</strong><p>Using ROE <code>${escapeHtml(state.authorisation.id)}</code> from failed baseline <code>${escapeHtml(state.run.id)}</code>. The server will still validate the uploaded run and the exact comparison requirements.</p></div>`);
  }
  return true;
}

if (assessmentId && requestedCase && planId) {
  if (retestRequested) void loadRetestState();
  const observer = new MutationObserver(() => {
    void applyContext().then((done) => { if (done && (!retestRequested || document.querySelector('#authorisationChoice')?.disabled || document.querySelector('[data-exact-retest-blocked]'))) observer.disconnect(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void applyContext();
}
