function fixStageLabel(root) {
  const step = root.querySelector('[data-result-evidence-journey] .workspace-next-action small');
  if (step && /Current step\s*·\s*PROVE/i.test(step.textContent || '')) step.textContent = 'Current step · Evidence';
}

function clarifyDeclaredConcerns(root) {
  const section = root.querySelector('#priorityRisks');
  if (!section || section.dataset.declaredConcernsNormalised === 'true') return;
  section.dataset.declaredConcernsNormalised = 'true';
  const eyebrow = section.querySelector('.eyebrow');
  const heading = section.querySelector('h2');
  const explanation = heading?.nextElementSibling;
  if (eyebrow) eyebrow.textContent = 'Declared concerns';
  if (heading && !/No declared weakness/i.test(heading.textContent || '')) heading.textContent = 'Questionnaire concerns — not confirmed findings';
  if (explanation) explanation.textContent = 'These concerns come from questionnaire answers. They stay separate from Findings until reviewed evidence or an authorised bounded test proves a failure.';

  const children = [...section.childNodes];
  const details = document.createElement('details');
  details.className = 'workspace-technical declared-concerns-details';
  details.dataset.declaredConcernsDetails = 'true';
  const summary = document.createElement('summary');
  summary.innerHTML = '<span>Review declared concerns</span><small>Secondary until evidence confirms a failure</small>';
  const body = document.createElement('div');
  body.className = 'workspace-technical-body';
  children.forEach((node) => body.appendChild(node));
  details.append(summary, body);
  section.appendChild(details);

  const nav = root.querySelector('.workspace-local-nav a[href="#priorityRisks"]');
  if (nav) nav.textContent = 'Declarations';
}

function keepPrimaryJourneyFirst(root) {
  const journey = root.querySelector('[data-result-evidence-journey]');
  const decision = root.querySelector('.result-decision-card');
  if (!journey || !decision || journey.dataset.primaryJourneyPlaced === 'true') return;
  journey.dataset.primaryJourneyPlaced = 'true';
  decision.insertAdjacentElement('afterend', journey);
}

function apply() {
  const root = document.querySelector('#resultRoot');
  if (!root || !root.querySelector('.result-decision-card')) return false;
  fixStageLabel(root);
  clarifyDeclaredConcerns(root);
  keepPrimaryJourneyFirst(root);
  return true;
}

const observer = new MutationObserver(apply);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
apply();
