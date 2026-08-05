import { api, escapeHtml } from './shared.js';

const form = document.querySelector('#riskFilters');
const fieldNames = ['query','category','severity','framework','owner','testMode','automationStatus'];
const fields = Object.fromEntries(fieldNames.map((name) => [name, document.querySelector(`[name="${name}"]`)]));
const status = document.querySelector('#riskLibraryStatus');
const results = document.querySelector('#riskLibraryResults');
let catalogue = [];

function severityClass(value) { return ['critical','high','medium','low'].includes(value) ? value : 'none'; }
function operational(entry) {
  return entry.operationalMetadata || {
    testMode: entry.operational_summary?.test_mode,
    automationStatus: entry.operational_summary?.automation_status,
    customerValidationStatus: entry.operational_summary?.customer_validation_status,
  };
}
function owner(entry) { return entry.solutionSummary?.defaultOwner || entry.solution_summary?.default_owner || ''; }
function card(entry) {
  const level = entry.problem?.default_severity || 'unknown';
  const op = operational(entry);
  return `<article class="panel risk-library-card">
    <div class="finding-head"><span class="eyebrow">${escapeHtml(entry.category)}</span><span class="severity ${severityClass(level)}">${escapeHtml(level)}</span></div>
    <h2>${escapeHtml(entry.title)}</h2><h3>Problem</h3><p>${escapeHtml(entry.problem?.statement || '')}</p>
    <div class="risk-card-meta"><span>${escapeHtml(op.testMode || 'unclassified')} test</span><span>${escapeHtml(op.customerValidationStatus || 'unvalidated')}</span>${owner(entry) ? `<span>${escapeHtml(owner(entry))}</span>` : ''}</div>
    <div class="button-row"><a class="button ghost small" href="/risk-library-detail.html?id=${encodeURIComponent(entry.id)}">Review the control</a></div>
    <p class="muted">${escapeHtml(entry.id)} · ${escapeHtml(entry.knowledgeVersion || entry.knowledge_version || '')}</p></article>`;
}
function fillSelect(select, values) {
  const first = select.options[0]?.outerHTML || '<option value="">All</option>';
  select.innerHTML = first + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
}
function normalizeStatic(entry) {
  return {
    ...entry,
    knowledgeVersion: entry.knowledge_version,
    solutionSummary: entry.solution_summary ? {
      defaultOwner: entry.solution_summary.default_owner,
      priority: entry.solution_summary.priority,
    } : null,
    operationalMetadata: entry.operational_summary ? {
      testMode: entry.operational_summary.test_mode,
      automationStatus: entry.operational_summary.automation_status,
      customerValidationStatus: entry.operational_summary.customer_validation_status,
    } : null,
  };
}
async function loadCatalogue() {
  try {
    const data = await api('/api/risk-knowledge?limit=250');
    catalogue = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    const response = await fetch('/risk-knowledge-public-v1.1.json', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The risk library could not be loaded.');
    const data = await response.json();
    catalogue = (data.entries || []).map(normalizeStatic);
  }
  fillSelect(fields.category, [...new Set(catalogue.map((entry) => entry.category).filter(Boolean))].sort());
  fillSelect(fields.framework, [...new Set(catalogue.flatMap((entry) => (entry.mappings || []).map((mapping) => mapping.framework)).filter(Boolean))].sort());
  fillSelect(fields.owner, [...new Set(catalogue.map(owner).filter(Boolean))].sort());
}
function localFilter(entries) {
  const term = fields.query.value.trim().toLowerCase();
  return entries.filter((entry) => (!term || `${entry.title} ${entry.category} ${entry.problem?.statement}`.toLowerCase().includes(term))
    && (!fields.category.value || entry.category === fields.category.value)
    && (!fields.severity.value || entry.problem?.default_severity === fields.severity.value)
    && (!fields.framework.value || (entry.mappings || []).some((mapping) => mapping.framework === fields.framework.value))
    && (!fields.owner.value || owner(entry) === fields.owner.value)
    && (!fields.testMode.value || operational(entry)?.testMode === fields.testMode.value)
    && (!fields.automationStatus.value || operational(entry)?.automationStatus === fields.automationStatus.value));
}
async function load() {
  status.hidden = false;
  status.textContent = 'Loading risk knowledge…';
  results.innerHTML = '';
  const params = new URLSearchParams();
  for (const [name, element] of Object.entries(fields)) if (element?.value?.trim()) params.set(name, element.value.trim());
  try {
    let entries;
    try {
      const data = await api(`/api/risk-knowledge?${params.toString()}`);
      entries = Array.isArray(data.entries) ? data.entries : [];
    } catch {
      entries = localFilter(catalogue);
    }
    status.textContent = `${entries.length} risk ${entries.length === 1 ? 'entry' : 'entries'} found.`;
    results.innerHTML = entries.map(card).join('') || '<div class="panel risk-empty"><p>No matching risks.</p></div>';
  } catch (error) {
    status.textContent = 'The risk library could not be loaded.';
    results.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
await loadCatalogue();
await load();
