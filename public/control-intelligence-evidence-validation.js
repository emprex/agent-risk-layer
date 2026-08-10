const requiredEvidenceFields = [
  ['#evidenceTitle', 'Evidence title'],
  ['#evidenceObserved', 'What was observed?'],
  ['#evidenceReference', 'Source reference'],
];

function evidenceForm() {
  return document.querySelector('#evidenceForm');
}

function markEvidenceFieldsRequired() {
  const form = evidenceForm();
  if (!form) return;
  for (const [selector] of requiredEvidenceFields) {
    const field = form.querySelector(selector);
    if (!field) continue;
    field.required = true;
    field.setAttribute('aria-required', 'true');
  }
}

function showEvidenceValidationError(label, field) {
  const message = `${label} is required before evidence can be recorded.`;
  field.setCustomValidity(message);
  field.reportValidity();
  const status = document.querySelector('#ciMessage');
  if (status) {
    status.className = 'error-box show';
    status.textContent = message;
    status.focus?.();
  }
}

const observer = new MutationObserver(markEvidenceFieldsRequired);
observer.observe(document.documentElement, { childList: true, subtree: true });
markEvidenceFieldsRequired();

document.addEventListener('input', (event) => {
  if (!event.target.closest?.('#evidenceForm')) return;
  event.target.setCustomValidity?.('');
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'evidenceForm') return;
  markEvidenceFieldsRequired();
  for (const [selector, label] of requiredEvidenceFields) {
    const field = form.querySelector(selector);
    if (!field || String(field.value || '').trim()) continue;
    event.preventDefault();
    event.stopImmediatePropagation();
    showEvidenceValidationError(label, field);
    return;
  }
}, true);
