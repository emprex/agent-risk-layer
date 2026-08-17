// Customer-facing guidance discovered through the Northstar normal-user journey.
// Presentation only: this module does not create applicability decisions, test results,
// evidence, findings, approvals or deployment decisions.

const page = location.pathname.split('/').pop();
const isControlPage = page === 'control-intelligence-control.html';
const isOverviewPage = page === 'control-intelligence.html';

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function addChoiceHelp(label, copy) {
  if (!label || label.querySelector('.ci-choice-explanation')) return;
  label.append(make('small', 'ci-choice-explanation', copy));
}

function enhanceApplicability() {
  if (!isControlPage) return;
  const form = document.querySelector('#applicabilityForm');
  if (!form || form.dataset.customerGuidance === 'true') return;
  form.dataset.customerGuidance = 'true';

  const applicable = form.querySelector('input[name="decision"][value="applicable"]')?.closest('label');
  const notApplicable = form.querySelector('input[name="decision"][value="not_applicable"]')?.closest('label');
  const contextRequired = form.querySelector('input[name="decision"][value="context_required"]')?.closest('label');

  addChoiceHelp(applicable, 'Relevant to this system. This is not a vulnerability, failed test or finding.');
  addChoiceHelp(notApplicable, 'Use only when confirmed system facts support that this control does not apply.');
  addChoiceHelp(contextRequired, 'Use when you cannot decide from the known facts. Missing information remains unknown; it is not a finding.');

  const intro = form.previousElementSibling?.querySelector('p');
  setText(intro, 'First decide whether this security question is relevant to the exact system version. Applicability only defines review scope; it does not say the control has failed.');
}

function executionGuidance(hasPlan) {
  const section = document.createElement('section');
  section.className = 'ci-test-execution-guide';
  section.dataset.customerTestGuide = 'true';

  const heading = make('h3', '', hasPlan ? 'How to execute the saved test plan' : 'How this test step works');
  const intro = make('p', '', 'This Control Intelligence form records a bounded test and its outcome. It does not independently operate your agent or customer systems.');
  const flow = document.createElement('div');
  flow.className = 'ci-test-flow';
  for (const [label, detail] of [
    ['1 · Plan', 'Define the exact safe test.'],
    ['2 · Execute', 'Run that plan in an authorised bounded environment.'],
    ['3 · Record', 'Return the observed result and side-effect outcome.'],
    ['4 · Evidence', 'Attach evidence to that exact execution; trust stays explicit.'],
  ]) {
    const item = document.createElement('div');
    item.append(make('strong', '', label), make('span', '', detail));
    flow.append(item);
  }

  const routes = document.createElement('div');
  routes.className = 'ci-test-routes';
  const manual = document.createElement('div');
  manual.append(
    make('strong', '', 'Normal route'),
    make('p', '', 'Run the exact planned scenario against the authorised version you are assessing. Prefer synthetic, test or staging data and prevent unintended side effects. Then return here and record only what actually happened.'),
  );
  const specialist = document.createElement('div');
  specialist.append(
    make('strong', '', 'Specialist route'),
    make('p', '', 'If the scenario maps to a supported controlled attack case, use AgentRiskLayer Controlled attack testing. It creates rules-bound customer-operated non-production test commands; it does not automatically execute this Control Intelligence plan.'),
  );
  const link = document.createElement('a');
  link.className = 'button ghost small';
  link.href = '/redteam.html';
  link.textContent = 'Open controlled attack testing';
  specialist.append(link);
  routes.append(manual, specialist);

  const boundary = make('p', 'ci-test-boundary', 'No executed result means no test evidence. A planned, missing or inconclusive result must not be turned into a finding.');
  section.append(heading, intro, flow, routes, boundary);
  return section;
}

function updateTestButton(form, hasPlan) {
  const select = form.querySelector('#testResult');
  const button = form.querySelector('button[type="submit"]');
  if (!select || !button) return;

  const plannedOption = [...select.options].find((option) => option.value === 'planned');
  setText(plannedOption, 'Plan only — not executed');

  const sync = () => {
    const label = select.value === 'planned'
      ? 'Save test plan — no evidence yet'
      : select.value
        ? 'Save executed test result'
        : hasPlan ? 'Record executed result' : 'Choose test status';
    setText(button, label);
  };
  if (select.dataset.customerGuidance !== 'true') {
    select.dataset.customerGuidance = 'true';
    select.addEventListener('change', sync);
  }
  sync();
}

function enhanceTest() {
  if (!isControlPage) return;
  const form = document.querySelector('#testForm');
  if (!form) return;
  const hasPlan = Boolean(document.querySelector('.ci-proof-strip'));
  updateTestButton(form, hasPlan);

  if (!document.querySelector('[data-customer-test-guide="true"]')) {
    form.insertAdjacentElement('beforebegin', executionGuidance(hasPlan));
  }

  const observed = form.querySelector('#observed')?.closest('label');
  if (observed && !observed.querySelector('.ci-field-help')) {
    observed.append(make('small', 'ci-field-help', 'Complete this only after execution. Describe the observed behaviour, not what you expected or hoped would happen.'));
  }
  const sideEffect = form.querySelector('#sideEffect')?.closest('label');
  if (sideEffect && !sideEffect.querySelector('.ci-field-help')) {
    sideEffect.append(make('small', 'ci-field-help', 'Record the real outcome. “Unknown” is valid when you cannot establish whether a side effect occurred.'));
  }
}

function enhanceControls() {
  if (!isOverviewPage) return;
  const view = new URLSearchParams(location.search).get('view') || 'overview';
  if (view !== 'controls') return;
  const panel = document.querySelector('#controls');
  if (!panel || panel.querySelector('[data-customer-control-guide="true"]')) return;

  const guide = document.createElement('section');
  guide.className = 'ci-customer-control-guide';
  guide.dataset.customerControlGuide = 'true';
  guide.append(
    make('strong', '', 'Start with the controls matched to this agent'),
    make('p', '', 'You do not need to open all 108 controls one by one. AgentRiskLayer uses the immutable snapshot to suggest likely-relevant controls. Review those suggestions in batches, then handle exceptions or missing context. Suggestions are not applicability decisions, and unmatched controls are not silently marked not applicable.'),
  );
  const actions = panel.querySelector('.ci-bulk-actions');
  actions?.insertAdjacentElement('beforebegin', guide);

  const selectSuggested = panel.querySelector('#selectSuggested');
  setText(selectSuggested, 'Select architecture-matched controls');
}

function enhance() {
  enhanceApplicability();
  enhanceTest();
  enhanceControls();
}

const root = document.querySelector(isControlPage ? '#ciControlRoot' : '#ciRoot');
if (root) {
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhance();
    });
  });
  observer.observe(root, { childList: true, subtree: true });
}
enhance();
