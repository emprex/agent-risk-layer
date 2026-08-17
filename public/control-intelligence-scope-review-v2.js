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

function parseFacts(value) {
  return String(value || '').split(',').map((item) => item.trim().replaceAll('\\:', ':').replaceAll('\\_', '_')).filter(Boolean);
}

function confidenceFor(meta) {
  const facts = parseFacts(meta?.factText);
  const riskBearing = facts.some((fact) => /^(audience:customer_facing|data:|tool:(write|payment|admin|code_execution|deployment)|authority:|identity:(tenant_scope|roles))$/.test(fact));
  // One broad fact such as staging or tool:read is not enough to prepare an applicability decision.
  // Preparation is intentionally conservative: at least two confirmed facts and one risk-bearing fact are required.
  const prepare = Boolean(meta?.serverSuggested && facts.length >= 2 && riskBearing);
  return { facts, prepare };
}

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
    const meta = {
      controlId: box.dataset.bulkControl,
      status,
      title,
      rationale,
      factText,
      serverSuggested: /suggested check|strong architecture match/i.test(status),
    };
    map.set(box.dataset.bulkControl, { ...meta, ...confidenceFor(meta) });
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
  if (intro) intro.textContent = 'AgentRiskLayer matches security questions to the immutable system snapshot. A match means relevant to review; it is not a vulnerability, failed control or confirmed applicability decision.';

  const guide = document.createElement('section');
  guide.className = 'ci-scope-guide';
  const guideCopy = document.createElement('div');
  guideCopy.append(
    make('span', 'eyebrow', 'Customer scope review'),
    make('h3', '', 'Review the uncertain scope, not 108 controls one by one'),
    make('p', '', 'AgentRiskLayer can prepare only higher-confidence applicability suggestions from multiple confirmed snapshot facts. Broad or single-fact matches stay unselected for your confirmation. Nothing is saved until you review and confirm the batch.'),
  );
  const principles = document.createElement('div');
  principles.className = 'ci-scope-principles';
  principles.setAttribute('aria-label', 'Scope review principles');
  principles.append(
    make('span', '', 'Matched ≠ applicable'),
    make('span', '', 'Applicable ≠ failed'),
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
    if (status && /suggested/i.test(status.textContent || '')) status.textContent = 'Suggested check · architecture match';
    const title = row.querySelector('h3');
    if (title && !row.querySelector('.ci-security-question-label')) {
      title.insertAdjacentElement('beforebegin', make('span', 'ci-security-question-label', 'Security question — not a finding'));
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
  const prepared = Boolean(meta?.prepare);

  if (prepared && decision && reason && facts.length) {
    decision.value = 'applicable';
    facts.forEach((fact) => { fact.checked = true; });
    const confirmedFacts = facts.map((fact) => human(fact.value)).join(', ');
    reason.value = `Suggested as relevant to this exact system snapshot because multiple confirmed architecture facts match this control: ${confirmedFacts}.`;
  }

  fieldset.classList.add(prepared ? 'ci-scope-row-prepared' : 'ci-scope-row-exception');
  const legend = fieldset.querySelector(':scope > legend');
  const summaryCard = document.createElement('div');
  summaryCard.className = 'ci-scope-row-summary';
  const summaryCopy = document.createElement('div');
  summaryCopy.append(
    make('span', `ci-scope-badge ${prepared ? 'prepared' : 'review'}`, prepared ? 'Prepared suggestion · likely applicable' : 'Confirmation required'),
    make('strong', '', meta?.title || controlId),
    make('p', '', meta?.rationale || 'Review this security question against the confirmed system facts.'),
  );
  const factSummary = meta?.factText || (facts.length ? `${facts.length} snapshot fact${facts.length === 1 ? '' : 's'}` : 'No deterministic fact match');
  summaryCard.append(summaryCopy, make('span', 'ci-scope-facts', factSummary));
  legend?.insertAdjacentElement('afterend', summaryCard);

  const details = document.createElement('details');
  details.className = 'ci-scope-row-details';
  if (!prepared) details.open = true;
  details.append(make('summary', '', prepared ? 'Review or change this prepared suggestion' : 'Confirm this control scope'));

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
      badge.textContent = 'Confirmation required';
      badge.className = 'ci-scope-badge review';
      details.open = true;
    } else if (prepared && value === 'applicable') {
      badge.textContent = 'Prepared suggestion · likely applicable';
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
  const prepared = rows.filter((row) => selectedMeta.get(row.dataset.bulkRow)?.prepare).length;
  const exceptions = rows.length - prepared;

  section.querySelector('h2').textContent = 'Review scope before saving';
  const intro = section.querySelector('h2 + p');
  if (intro) intro.textContent = 'Only higher-confidence matches are prepared. Single-fact or broad matches remain unselected and visible below for confirmation. Suggestions are not saved until you confirm.';

  const summary = document.createElement('div');
  summary.className = 'ci-scope-review-summary';
  const summaryItems = [
    [rows.length, 'selected controls'],
    [prepared, 'prepared suggestions'],
    [exceptions, 'need confirmation'],
  ];
  for (const [value, label] of summaryItems) {
    const item = document.createElement('div');
    item.append(make('strong', '', String(value)), make('span', '', label));
    summary.append(item);
  }
  summary.append(make('p', '', 'Saving creates individual snapshot-bound applicability decisions only. It does not create test results, findings, remediation records, approvals or a deployment decision.'));
  form.insertAdjacentElement('beforebegin', summary);

  rows.forEach((row) => setRowState(row, selectedMeta.get(row.dataset.bulkRow)));

  if (prepared) {
    const toggle = make('button', 'button ghost small ci-scope-prepared-toggle', `Review ${prepared} prepared suggestion${prepared === 1 ? '' : 's'}`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const showing = form.classList.toggle('ci-show-prepared');
      toggle.setAttribute('aria-expanded', String(showing));
      toggle.textContent = showing ? 'Hide prepared suggestions' : `Review ${prepared} prepared suggestion${prepared === 1 ? '' : 's'}`;
    });
    form.insertAdjacentElement('beforebegin', toggle);
  }

  if (exceptions) {
    const exceptionNote = make('div', 'ci-scope-exception-note', `${exceptions} control${exceptions === 1 ? '' : 's'} need your confirmation because the snapshot match is too broad to prepare an applicability decision safely.`);
    form.insertAdjacentElement('beforebegin', exceptionNote);
  }

  const reviewSummaryHeading = [...form.querySelectorAll('h3')].find((node) => /review summary/i.test(node.textContent || ''));
  if (reviewSummaryHeading) {
    reviewSummaryHeading.textContent = 'Save scope decisions';
    const p = reviewSummaryHeading.nextElementSibling;
    if (p?.tagName === 'P') p.textContent = `${rows.length} individual applicability decisions will be validated against this exact immutable snapshot. Any unconfirmed required decision keeps the batch from saving.`;
  }

  const confirm = form.querySelector('#bulkConfirm');
  const confirmLabel = confirm?.closest('label');
  if (confirmLabel) {
    confirmLabel.classList.add('ci-scope-final-confirm');
    const textNode = [...confirmLabel.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = ' I reviewed the prepared suggestions and confirmed every uncertain item. Save these as individual applicability decisions for this exact snapshot.';
  }

  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = 'Save confirmed scope';

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
