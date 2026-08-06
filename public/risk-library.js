import { api, escapeHtml } from './shared.js';
import { severityPresentation } from './risk-knowledge-core.js';

const form = document.querySelector('#riskFilters');
const fieldNames = ['query','category','severityStatus','framework','owner','validationStatus','testMode','automationStatus','sort'];
const fields = Object.fromEntries(fieldNames.map((name) => [name, document.querySelector(`[name="${name}"]`)]));
const status = document.querySelector('#riskLibraryStatus');
const results = document.querySelector('#riskLibraryResults');
const loadMore = document.querySelector('#riskLoadMore');
const PAGE_SIZE = 24;
let offset = 0;
let currentItems = [];

function operational(entry) { return entry.operationalMetadata || {}; }
function owner(entry) { return entry.solutionSummary?.defaultOwner || ''; }
function card(entry) {
  const validation = entry.validation?.status || 'candidate';
  const severityText = severityPresentation(entry);
  return `<article class="panel risk-library-card" tabindex="0"><div class="finding-head"><span class="eyebrow">${escapeHtml(entry.category)}</span><span class="severity none" title="Catalogue controls do not carry a universal severity. AgentRiskLayer assigns severity after evaluating the control against a specific agent’s access, data, authority, exposure, safeguards and potential impact.">${escapeHtml(severityText)}</span></div><h2>${escapeHtml(entry.title)}</h2><h3>Problem</h3><p>${escapeHtml(entry.problem?.statement || '')}</p><div class="risk-card-meta"><span>${escapeHtml(operational(entry).testMode || 'unclassified')} test</span><span>${escapeHtml(validation.replaceAll('_', ' '))}</span>${owner(entry) ? `<span>${escapeHtml(owner(entry))}</span>` : ''}</div><div class="button-row"><a class="button ghost small" href="/risk-library-detail.html?id=${encodeURIComponent(entry.id)}">Review the control</a></div><p class="muted">${escapeHtml(entry.id)} · ${escapeHtml(entry.knowledgeVersion || '')}</p></article>`;
}
function fillSelect(select, options) {
  const selected = select.value;
  const first = select.options[0]?.outerHTML || '<option value="">All</option>';
  select.innerHTML = first + (options || []).filter((option) => option.count > 0).map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.value.replaceAll('_', ' '))} (${option.count})</option>`).join('');
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}
function parameters() {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  for (const [name, element] of Object.entries(fields)) if (element?.value?.trim()) params.set(name, element.value.trim());
  return params;
}
async function load({ append = false } = {}) {
  status.textContent = 'Loading risk knowledge…';
  if (!append) { offset = 0; currentItems = []; results.innerHTML = ''; }
  try {
    const data = await api(`/api/risk-knowledge?${parameters()}`);
    const items = Array.isArray(data.items) ? data.items : [];
    currentItems = append ? [...currentItems, ...items] : items;
    results.innerHTML = currentItems.map(card).join('') || '<div class="panel risk-empty"><p>No controls match these filters. Clear a filter or broaden the search.</p></div>';
    status.textContent = `Showing ${currentItems.length} of ${Number(data.total || 0)} active controls. Catalogue severity requires project context; null does not mean low or absent risk.`;
    loadMore.hidden = !data.hasMore;
    loadMore.dataset.nextOffset = String(Number(data.offset || 0) + items.length);
    const filters = data.filters || {};
    for (const name of ['category','severityStatus','framework','owner','validationStatus','testMode','automationStatus']) fillSelect(fields[name], filters[name]);
  } catch (error) {
    status.textContent = 'The risk library could not be loaded.';
    results.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
    loadMore.hidden = true;
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
form.addEventListener('change', () => load());
loadMore.addEventListener('click', () => { offset = Number(loadMore.dataset.nextOffset || currentItems.length); load({ append: true }); });
await load();
