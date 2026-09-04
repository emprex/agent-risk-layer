const root = document.querySelector('#resultRoot');

function text(node) {
  return String(node?.textContent || '').trim();
}

function ensureHeading(section, selector, fallback) {
  const heading = section?.querySelector(selector);
  if (heading && !text(heading)) heading.textContent = fallback;
}

function cleanEmptyParagraphs(container) {
  container?.querySelectorAll('p').forEach((paragraph) => {
    if (!text(paragraph)) paragraph.remove();
  });
}

function normaliseObservationCards(section, fallbackLabel) {
  if (!section) return;
  const cards = [...section.querySelectorAll('article.observed-finding')];
  cards.forEach((card, index) => {
    const heading = card.querySelector('h4');
    if (heading && !text(heading)) heading.textContent = `${fallbackLabel} ${index + 1}`;
    cleanEmptyParagraphs(card);
  });
}

function addEmptyState(section, message) {
  if (!section || section.querySelector('article.observed-finding') || section.querySelector('[data-technical-evidence-empty]')) return;
  const note = document.createElement('p');
  note.className = 'microcopy';
  note.dataset.technicalEvidenceEmpty = 'true';
  note.textContent = message;
  section.append(note);
}

function repairTechnicalEvidence() {
  const details = root?.querySelector('#evidenceDetails');
  if (!details) return false;

  const inspection = details.querySelector('.inspection-panel');
  if (inspection) {
    ensureHeading(inspection, 'h3', 'Source observations');
    normaliseObservationCards(inspection, 'Source observation');
    cleanEmptyParagraphs(inspection);
    addEmptyState(inspection, 'No detailed source observations are shown on this result surface. Review Evidence for the complete inspection record.');
  }

  const redTeam = details.querySelector('.redteam-panel');
  if (redTeam) {
    ensureHeading(redTeam, 'h3', 'Bounded test evidence');
    normaliseObservationCards(redTeam, 'Bounded test result');
    cleanEmptyParagraphs(redTeam);
    addEmptyState(redTeam, 'No detailed bounded-test result is shown on this result surface. Review Runtime evidence for the complete test record.');
  }

  details.querySelectorAll('h3, h4').forEach((heading) => {
    if (!text(heading)) heading.remove();
  });
  details.dataset.technicalEvidenceIntegrity = 'true';
  return true;
}

if (root) {
  const observer = new MutationObserver(() => repairTechnicalEvidence());
  observer.observe(root, { childList: true, subtree: true });
  repairTechnicalEvidence();
  setTimeout(() => observer.disconnect(), 10000);
}
