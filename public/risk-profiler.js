import { api, escapeHtml, setBusy } from './shared.js';

const form = document.querySelector('#riskProfiler');
const grid = document.querySelector('#riskFactGrid');
const status = document.querySelector('#profileStatus');
const results = document.querySelector('#profileResults');
const projectActions = document.querySelector('#profileProjectActions');
const projectId = new URLSearchParams(location.search).get('projectId');
let registry = [];
let latestFacts = null;

function select(predicate) {
  return `<div class="risk-fact" data-fact="${escapeHtml(predicate.key)}" data-parent="${escapeHtml(predicate.displayWhen?.fact || '')}" hidden><label for="fact-${escapeHtml(predicate.key)}">${escapeHtml(predicate.label)}</label><p class="muted">${escapeHtml(predicate.justification)}</p><select id="fact-${escapeHtml(predicate.key)}" name="${escapeHtml(predicate.key)}"><option value="unknown">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></div>`;
}
function explanatory(predicate) {
  return `<div class="risk-fact predicate-explanation"><strong>${escapeHtml(predicate.label)}</strong><span class="risk-status-pill unknown">${escapeHtml(predicate.classification)}</span><p>${escapeHtml(predicate.justification)}</p></div>`;
}
function updateVisibility() {
  for (const element of grid.querySelectorAll('[data-fact]')) {
    const parent = element.dataset.parent;
    element.hidden = Boolean(parent) && form.elements[parent]?.value !== 'true';
    if (element.hidden) form.elements[element.dataset.fact].value = 'unknown';
  }
}
function factsFromForm() {
  return Object.fromEntries(registry.filter((item) => item.classification === 'user-answerable').map(({ key }) => {
    const value = form.elements[key]?.value || 'unknown';
    return [key, value === 'true' ? true : value === 'false' ? false : null];
  }));
}
function card(item) {
  const label = item.applicability.status === 'unknown' ? 'Review required' : item.applicability.status === 'not_applicable' ? 'Not applicable' : 'Applicable';
  return `<article class="panel risk-library-card"><div class="finding-head"><span class="eyebrow">${escapeHtml(item.entry.category)}</span><span class="risk-status-pill ${escapeHtml(item.applicability.status)}">${escapeHtml(label)}</span></div><h2>${escapeHtml(item.entry.title)}</h2><p>${escapeHtml(item.entry.problem?.statement || '')}</p><p class="muted">${escapeHtml(item.applicability.reason || '')}</p><a class="button ghost small" href="/risk-library-detail.html?id=${encodeURIComponent(item.entry.id)}">Review control</a></article>`;
}

const registryData = await api('/api/risk-knowledge-predicates');
registry = registryData.predicates || [];
const answerable = registry.filter((item) => item.classification === 'user-answerable');
const explained = registry.filter((item) => item.classification !== 'user-answerable');
grid.innerHTML = answerable.map(select).join('') + `<section class="predicate-registry"><h2>Derived and review-only facts</h2><p>These predicates are not silently guessed. They remain Unknown until their documented source resolves them.</p>${explained.map(explanatory).join('')}</section>`;
updateVisibility();
form.addEventListener('change', updateVisibility);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Building the profile…';
  results.innerHTML = '';
  try {
    latestFacts = factsFromForm();
    const data = await api('/api/risk-knowledge/profile', { method: 'POST', body: JSON.stringify({ facts: latestFacts }) });
    const items = Array.isArray(data.results) ? data.results : [];
    const applicable = items.filter((item) => item.applicability.status === 'applicable');
    const unknown = items.filter((item) => item.applicability.status === 'unknown');
    const excluded = items.filter((item) => item.applicability.status === 'not_applicable');
    status.textContent = `${applicable.length} applicable, ${unknown.length} review required, ${excluded.length} not applicable. Unknown was not treated as safe.`;
    results.innerHTML = `<div class="profile-groups"><h2>Applicable</h2>${applicable.map(card).join('') || '<p>None currently identified.</p>'}<h2>Review required</h2>${unknown.map(card).join('') || '<p>None.</p>'}<h2>Not applicable, with justification</h2>${excluded.map(card).join('') || '<p>None.</p>'}</div>`;
    if (projectId) projectActions.innerHTML = '<section class="risk-access-box"><h2>Save this scope to the authorised project</h2><p>This records applicability only. Existing findings remain visible and continue to drive the server-derived gate.</p><button id="saveRiskProfile" class="button primary" type="button">Save project risk scope</button></section>';
  } catch (error) { status.textContent = error.message; }
});
projectActions.addEventListener('click', async (event) => {
  const button = event.target.closest('#saveRiskProfile');
  if (!button || !projectId || !latestFacts) return;
  setBusy(button, true, 'Saving…');
  try {
    const saved = await api(`/api/projects/${encodeURIComponent(projectId)}/risk-knowledge-profile`, { method: 'PUT', body: JSON.stringify({ facts: latestFacts }) });
    projectActions.innerHTML = `<section class="success-box"><strong>Project scope saved.</strong><p>${Number(saved.summary?.applicable || 0)} applicable and ${Number(saved.summary?.unknown || 0)} review-required controls. Open findings were preserved.</p><a class="button ghost small" href="/risk-readiness.html?projectId=${encodeURIComponent(projectId)}">Open Evidence Readiness</a></section>`;
  } catch (error) { setBusy(button, false); status.textContent = error.message; }
});
form.addEventListener('reset', () => window.setTimeout(() => { latestFacts = null; updateVisibility(); status.textContent = ''; projectActions.innerHTML = ''; results.innerHTML = ''; }, 0));
