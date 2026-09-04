function meaningfulLabel(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && text !== '-' && text.toLowerCase() !== 'material evidence question';
}

function fixManualQuestions(plan) {
  const details = [...plan.querySelectorAll('details.workspace-technical')].find((item) => /other evidence question/i.test(item.querySelector('summary')?.textContent || ''));
  if (!details) return;
  const summaryText = details.querySelector('summary')?.textContent || '';
  const count = Number(summaryText.match(/\d+/)?.[0] || 0);
  const list = details.querySelector('ul.check-list');
  if (!list) return;
  const items = [...list.querySelectorAll('li')];
  const valid = items.filter((item) => meaningfulLabel(item.textContent));
  items.filter((item) => !valid.includes(item)).forEach((item) => item.remove());
  if (valid.length) return;
  const message = document.createElement('p');
  message.className = 'microcopy';
  message.textContent = `${count || items.length || 'Additional'} evidence questions remain open for reviewer-specific evidence. They are evidence gaps, not findings.`;
  list.replaceWith(message);
}

function collapseSecondaryChecks(plan) {
  const items = [...plan.querySelectorAll(':scope > .plain-finding-list > .finding-work-item')];
  if (items.length <= 1 || plan.querySelector('[data-secondary-bounded-checks]')) return;
  const wrapper = document.createElement('details');
  wrapper.className = 'workspace-technical section-gap';
  wrapper.dataset.secondaryBoundedChecks = 'true';
  const summary = document.createElement('summary');
  summary.innerHTML = `<span>${items.length - 1} additional bounded runtime check${items.length === 2 ? '' : 's'}</span><small>Open only after the current check is resolved</small>`;
  const body = document.createElement('div');
  body.className = 'workspace-technical-body plain-finding-list';
  items.slice(1).forEach((item) => body.appendChild(item));
  wrapper.append(summary, body);
  items[0].insertAdjacentElement('afterend', wrapper);
}

function simplifyPrimaryActions(plan) {
  const primary = plan.querySelector('[data-primary-evidence-check="true"]');
  const row = primary?.querySelector('.button-row');
  if (!row || primary.querySelector('[data-secondary-evidence-actions]')) return;
  const secondary = [...row.querySelectorAll('button.secondary')];
  if (!secondary.length) return;
  const details = document.createElement('details');
  details.className = 'workspace-technical';
  details.dataset.secondaryEvidenceActions = 'true';
  const summary = document.createElement('summary');
  summary.innerHTML = '<span>Other evidence dispositions</span><small>Use only when the bounded check cannot or should not run</small>';
  const body = document.createElement('div');
  body.className = 'workspace-technical-body button-row compact';
  secondary.forEach((button) => body.appendChild(button));
  details.append(summary, body);
  row.insertAdjacentElement('afterend', details);
}

function addCurrentStep(plan) {
  if (plan.querySelector('[data-current-evidence-step]')) return;
  const first = plan.querySelector('[data-primary-evidence-check="true"]');
  if (!first) return;
  const title = first.querySelector('h3')?.textContent?.trim() || 'Run the selected bounded check';
  const action = first.querySelector('a.button.primary, button.button.primary');
  const box = document.createElement('div');
  box.className = 'workspace-next-action';
  box.dataset.currentEvidenceStep = 'true';
  box.innerHTML = `<small>Current step · Evidence</small><strong>${title}</strong><p>Complete this bounded check before moving to the next evidence question. An error or inconclusive result remains evidence needed, not a finding.</p>`;
  if (action) {
    const clone = action.cloneNode(true);
    clone.classList.add('small');
    box.appendChild(clone);
  }
  first.insertAdjacentElement('beforebegin', box);
}

function apply() {
  const plan = document.querySelector('[data-evidence-plan]');
  if (!plan || plan.dataset.journeyFixApplied === 'true') return false;
  plan.dataset.journeyFixApplied = 'true';
  fixManualQuestions(plan);
  collapseSecondaryChecks(plan);
  simplifyPrimaryActions(plan);
  addCurrentStep(plan);
  return true;
}

const observer = new MutationObserver(apply);
observer.observe(document.documentElement, { childList: true, subtree: true });
apply();
