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

function confirmedFindingCount(root) {
  const heading = root.querySelector('[data-confirmed-findings] h2');
  if (heading && /No confirmed findings/i.test(heading.textContent || '')) return 0;
  const match = String(heading?.textContent || '').match(/(\d+)\s+confirmed finding/i);
  if (match) return Number(match[1]);
  const firstMetric = root.querySelector('.result-decision-card .result-reason-grid > div:first-child strong');
  const metric = Number(firstMetric?.textContent || NaN);
  return Number.isFinite(metric) ? metric : null;
}

function normaliseDeclaredConcernLabels(root) {
  const section = root.querySelector('#priorityRisks');
  if (!section) return;
  section.querySelectorAll('.finding-more summary').forEach((summary) => {
    const next = String(summary.textContent || '').replace(/additional findings?/i, (text) => text.toLowerCase().endsWith('s') ? 'additional concerns' : 'additional concern');
    if (next !== summary.textContent) summary.textContent = next;
  });
}

function normaliseConditionalActions(root) {
  if (confirmedFindingCount(root) !== 0) return;
  root.querySelectorAll('#actionPlan .simple-remediation-list article strong').forEach((title) => {
    if (/Do not deploy or expand while a critical finding remains unresolved/i.test(title.textContent || '')) {
      title.textContent = 'Do not expand deployment while material evidence gaps remain unresolved.';
    }
  });
}

function normaliseEvidenceLimitations(root) {
  const state = root.querySelector('[data-deployment-review] .result-limit-note p');
  const text = String(state?.textContent || '');
  const info = Number(text.match(/(\d+)\s+information gap/i)?.[1] || 0);
  const recorded = Number(text.match(/(\d+)\s+recorded evidence gap/i)?.[1] || 0);
  const reviewer = Number(text.match(/(\d+)\s+reviewer-defined evidence question/i)?.[1] || 0);
  if (!state || (!recorded && !reviewer)) return;
  const total = recorded + reviewer;
  const normalised = `${info} information gap${info === 1 ? '' : 's'} · ${total} evidence limitation${total === 1 ? '' : 's'} total (${recorded} recorded gap${recorded === 1 ? '' : 's'} · ${reviewer} reviewer-defined question${reviewer === 1 ? '' : 's'})`;
  if (state.textContent !== normalised) state.textContent = normalised;

  const summary = root.querySelector('.result-decision-card');
  const heading = summary?.querySelector('h2');
  const explanation = heading?.nextElementSibling;
  if (heading && /No confirmed findings/i.test(heading.textContent || '') && explanation) {
    const copy = `The frozen revision has been inspected and the bounded evidence plan has been reviewed. ${info} information gap${info === 1 ? '' : 's'} and ${total} evidence limitation${total === 1 ? '' : 's'} remain (${recorded} recorded gap${recorded === 1 ? '' : 's'} and ${reviewer} reviewer-defined question${reviewer === 1 ? '' : 's'}). These are not vulnerabilities, but they limit deployment assurance.`;
    if (explanation.textContent !== copy) explanation.textContent = copy;
  }
}

function normaliseRecordedDecision(root) {
  const review = root.querySelector('[data-deployment-review]');
  const reviewHeading = review?.querySelector('.workspace-section-heading h2');
  const match = String(reviewHeading?.textContent || '').match(/^Current decision:\s*(.+)$/i);
  if (!match) return;
  const decision = match[1].trim();

  const reviewCopy = review.querySelector('.workspace-section-heading p');
  const recordedCopy = 'This accountable human decision is recorded for the assessed revision. Review the remaining limitations before changing it.';
  if (reviewCopy && reviewCopy.textContent !== recordedCopy) reviewCopy.textContent = recordedCopy;

  const titleText = `Deployment decision recorded: ${decision}`;
  const bodyText = `${decision} is recorded for this frozen revision. Close the remaining information and evidence gaps before reassessment.`;

  const summaryNext = root.querySelector('.result-decision-card .result-next-action');
  const summaryTitle = summaryNext?.querySelector('strong');
  const summaryBody = summaryNext?.querySelector('p');
  const summaryButton = summaryNext?.querySelector('a.button');
  if (summaryTitle && summaryTitle.textContent !== titleText) summaryTitle.textContent = titleText;
  if (summaryBody && summaryBody.textContent !== bodyText) summaryBody.textContent = bodyText;
  if (summaryButton) {
    summaryButton.href = '#deploymentReview';
    if (summaryButton.textContent !== 'Review decision') summaryButton.textContent = 'Review decision';
  }

  const journeyNext = root.querySelector('[data-result-evidence-journey] .workspace-next-action');
  const journeyStep = journeyNext?.querySelector('small');
  const journeyTitle = journeyNext?.querySelector('strong');
  const journeyBody = journeyNext?.querySelector('p');
  const journeyButton = journeyNext?.querySelector('a.button');
  if (journeyStep && journeyStep.textContent !== 'Current step · DEPLOY') journeyStep.textContent = 'Current step · DEPLOY';
  if (journeyTitle && journeyTitle.textContent !== titleText) journeyTitle.textContent = titleText;
  if (journeyBody && journeyBody.textContent !== bodyText) journeyBody.textContent = bodyText;
  if (journeyButton) {
    journeyButton.href = '#deploymentReview';
    if (journeyButton.textContent !== 'Review decision') journeyButton.textContent = 'Review decision';
  }
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
  normaliseDeclaredConcernLabels(root);
  normaliseConditionalActions(root);
  normaliseEvidenceLimitations(root);
  normaliseRecordedDecision(root);
  keepPrimaryJourneyFirst(root);
  return true;
}

const observer = new MutationObserver(apply);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
apply();
