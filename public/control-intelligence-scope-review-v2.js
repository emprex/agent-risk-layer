// Normal-customer scope review for Control Intelligence.
// This module only prepares and compresses the existing applicability form.
// It does not submit, persist, or infer findings, evidence, test results, approvals or deployment decisions.

const root = document.querySelector('#ciRoot');
let selectedMeta = new Map();

const text = (node) => String(node?.textContent || '').trim();
const human = (value) => String(value || '').replaceAll('_', ' ').replaceAll(':', ': ');
const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
};

function captureSelection() {
  const map = new Map();
  document.querySelectorAll('[data-bulk-control]:checked').forEach((box) => {
    const row = box.closest('.ci-control-row');
    if (!row) return;
    const status = text(row.querySelector('.ci-status'));
    const title = text(row.querySelector('h3'));
    const rationale = text(row.querySelector('p'));
    const smalls = [...row.querySelectorAll('small')].map(text).filter(Boolean);
    const factText = smalls.at(-1) || '';
    map.set(box.dataset.bulkControl, {
      controlId: box.dataset.bulkControl,
      status,
      title,
      rationale,
      factText,
      strong: /strong architecture match/i.test(status),
    });
  });
  selectedMeta = map;
}

function decorateControls() {
  const panel = document.querySelector('#controls');
  if (!panel || panel.dataset.scopeReviewDecorated === 'true') return;
  panel.dataset.scopeReviewDecorated = 'true';

  const heading = panel.querySelector('h2');
  if (heading) heading.textContent = 'Scope the controls that matter to this agent';
  const intro = heading?.nextElementSibling;
  if (intro) intro.textContent = 'AgentRiskLayer matches security questions to the immutable system snapshot. Review the matched scope first; a matched control is relevant to review, not a vulnerability or failed control.';

  const guide = document.createElement('section');
  guide.className = 'ci-scope-guide';
  const guideCopy = document.createElement('div');
  guideCopy.append(
    make('span', 'eyebrow', 'Customer scope review'),
    make('h3', '', 'Review exceptions, not 108 controls one by one'),
    make('p', '', 'Strong architecture matches can be prepared as suggested applicability choices from facts you already confirmed in the immutable snapshot. Nothing is saved until you review and confirm the batch.'),
  );
  const principles = document.createElement('div');
  principles.className = 'ci-scope-principles';
  principles.setAttribute('aria-label', 'Scope review principles');
  principles.append(
    make('span', '', 'Matched ≠ failed'),
    make('span', '', 'Unknown ≠ finding'),
    make('span', '', 'No automatic deployment decision'),
  );
  guide.append(guideCopy, principles);
  panel.querySelector('.ci-bulk-actions')?.insertAdjacentElement('beforebegin', guide);

  const selectSuggested = panel.querySelector('#selectSuggested');
  if (selectSuggested) selectSuggested.textContent = 'Prepare matched scope';
  const reviewSelected = panel.querySelector('#reviewSelected');
  if (reviewSelected) reviewSelected.textContent = 'Review scope';
  const selectCategory = panel.querySelector('#selectCategory');
  if (selectCategory) selectCategory.textContent = 'Select this category';

  panel.querySelectorAll('.ci-control-row').forEach((row) => {
    const status = row.querySelector('.ci-status');
    if (status && /suggested/i.test(status.textContent || '')) status.textContent = 'Suggested check · strong architecture match';
    const title = row.querySelector('h3');
    if (title && !row.querySelector('.ci-security-question-label')) {
      title.insertAdjacentElement('beforebegin', make('span', 'ci-security-question-label', 'Security question'));
    }
  });
}

function setRowState(fieldset, meta) {
  if (!fieldset || fieldset.dataset.scopePrepared === 'true') return;
  fieldset.dataset.scopePrepared = 'true';
  const controlId = fieldset.dataset.bulkRow;
  const index = [...fieldset.parentElement.querySelectorAll('[data-bulk-row]')].indexOf(fieldset);
  const decision = fieldset.querySelector(`[name="decision-${index}"]`);
  const reason = fieldset.querySelector(`[name="reason-${index}"]`);
  const missing = fieldset.querySelector(`[name="missing-${index}"]`);
  const facts = [...fieldset.querySelectorAll(`[name="fact-${index}"]`)];
  const strong = Boolean(meta?.strong);

  if (strong && decision && reason && facts.length) {
    decision.value = 'applicable';
    facts.forEach((fact) => { fact.checked = true; });
    const confirmedFacts = facts.map((fact) => human(fact.value)).join(', ');
    reason.value = `Relevant to this exact system snapshot because its confirmed architecture matches this control: ${confirmedFacts}.`;
  }

  const legend = fieldset.querySelector(':scope > legend');
  const summaryCard = document.createElement('div');
  summaryCard.className = 'ci-scope-row-summary';
  const summaryCopy = document.createElement('div');
  summaryCopy.append(
    make('span', `ci-scope-badge ${strong ? 'prepared' : 'review'}`, strong ? 'Prepared suggestion · Applicable' : 'Needs your review'),
    make('strong', '', meta?.title || controlId),
    make('p', '', meta?.rationale || 'Review this security question against the confirmed system facts.'),
  );
  const factSummary = meta?.factText || (facts.length ? `${facts.length} snapshot fact${facts.length === 1 ? '' : 's'}` : 'No deterministic fact match');
  summaryCard.append(summaryCopy, make('span', 'ci-scope-facts', factSummary));
  legend?.insertAdjacentElement('afterend', summaryCard);

  const details = document.createElement('details');
  details.className = 'ci-scope-row-details';
  if (!strong) details.open = true;
  details.append(make('summary', '', strong ? 'Review or change this prepared decision' : 'Complete this decision'));

  const movable = [...fieldset.children].filter((node) => node !== legend && node !== summaryCard);
  movable.forEach((node) => details.append(node));
  fieldset.append(details);

  const missingLabel = missing?.closest('label');
  if (missingLabel) missingLabel.classList.add('ci-scope-missing');

  const badge = summaryCard.querySelector('.ci-scope-badge');
  const sync = () => {
    const value = decision?.value || '';
    if (missingLabel) missingLabel.hidden = value !== 'context_required';
    if (!badge) return;
    if (!value) {
      badge.textContent = 'Needs your review';
      badge.className = 'ci-scope-badge review';
      details.open = true;
    } else if (strong && value === 'applicable') {
      badge.textContent = 'Prepared suggestion · Applicable';
      badge.className = 'ci-scope-badge prepared';
    } else {
      badge.textContent = `Reviewed choice · ${value.replaceAll('_', ' ')}`;
      badge.className = 'ci-scope-badge changed';
    }
  };
  decision?.addEventListener('change', sync);
  sync();
}

function compactBulkReview() {
  const section = document.querySelector('#bulkReview');
  const form = section?.querySelector('#bulkForm');
  if (!section || !form || section.dataset.scopeReviewCompacted === 'true') return;
  section.dataset.scopeReviewCompacted = 'true';

  const rows = [...form.querySelectorAll('[data-bulk-row]')];
  const prepared = rows.filter((row) => selectedMeta.get(row.dataset.bulkRow)?.strong).length;
  const exceptions = rows.length - prepared;

  section.querySelector('h2').textContent = 'Review scope before saving';
  const intro = section.querySelector('h2 + p');
  if (intro) intro.textContent = 'AgentRiskLayer prepared strong architecture matches from the immutable snapshot. These are applicability suggestions only. Review any exceptions, then confirm once.';

  const summary = document.createElement('div');
  summary.className = 'ci-scope-review-summary';
  const summaryItems = [
    [rows.length, 'selected controls'],
    [prepared, 'prepared strong matches'],
    [exceptions, 'need manual review'],
  ];
  for (const [value, label] of summaryItems) {
    const item = document.createElement('div');
    item.append(make('strong', '', String(value)), make('span', '', label));
    summary.append(item);
  }
  summary.append(make('p', '', 'Saving creates individual snapshot-bound applicability decisions. It does not create test results, findings, remediation records or a deployment decision.'));
  form.insertAdjacentElement('beforebegin', summary);

  rows.forEach((row) => setRowState(row, selectedMeta.get(row.dataset.bulkRow)));

  const reviewSummaryHeading = [...form.querySelectorAll('h3')].find((node) => /review summary/i.test(node.textContent || ''));
  if (reviewSummaryHeading) {
    reviewSummaryHeading.textContent = 'Save scope decisions';
    const p = reviewSummaryHeading.nextElementSibling;
    if (p?.tagName === 'P') p.textContent = `${rows.length} individual applicability decisions will be validated against this exact immutable snapshot. The server rejects the batch if any decision is invalid.`;
  }

  const confirm = form.querySelector('#bulkConfirm');
  const confirmLabel = confirm?.closest('label');
  if (confirmLabel) {
    confirmLabel.classList.add('ci-scope-final-confirm');
    const textNode = [...confirmLabel.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = ' I reviewed the prepared scope and any exceptions. Save these as individual applicability decisions for this exact snapshot.';
  }

  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = 'Save scope decisions';

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (root) {
  const observer = new MutationObserver(() => decorateControls());
  observer.observe(root, { childList: true });
}

document.addEventListener('click', (event) => {
  const reviewButton = event.target.closest?.('#reviewSelected');
  if (!reviewButton) return;
  captureSelection();
  setTimeout(compactBulkReview, 0);
}, true);

decorateControls();
