import { api, escapeHtml, setBusy } from './shared.js';
import { evaluateApplicability } from './risk-knowledge-core.js';

const form = document.querySelector('#riskProfiler');
const grid = document.querySelector('#riskFactGrid');
const status = document.querySelector('#profileStatus');
const results = document.querySelector('#profileResults');
const projectActions = document.querySelector('#profileProjectActions');
const projectId = new URLSearchParams(location.search).get('projectId');
let latestFacts = null;
const FACTS = [
  ['is_production','Runs in production'],['is_hosted','Hosted service or platform'],['is_public','Internet-facing or public'],
  ['is_multi_tenant','Multi-tenant'],['uses_tools','Uses tools or APIs'],['uses_state_changing_tools','Tools can change external state'],
  ['uses_network_tools','Can access network destinations'],['uses_filesystem_tools','Can access filesystems'],['uses_code_execution','Can execute code or shell commands'],
  ['uses_mcp','Uses MCP servers'],['uses_multiple_agents','Multi-agent system'],['uses_planning_or_autonomy','Plans or acts autonomously'],
  ['uses_external_content','Processes external or untrusted content'],['uses_rag','Uses retrieval-augmented generation'],['uses_memory','Uses persistent memory'],
  ['processes_personal_data','Processes personal data'],['processes_non_public_data','Processes non-public data'],['requires_human_approval','Requires human approval'],
  ['performs_high_impact_actions','Can perform high-impact actions'],['outputs_to_web','Displays output in web interfaces'],['generates_files','Generates files'],
  ['uses_self_hosted_or_imported_model','Uses a self-hosted or imported model'],['uses_custom_or_finetuned_model','Uses a custom or fine-tuned model'],
  ['is_metered_or_commercial','Metered or commercial service'],['requires_defensible_evidence','Requires defensible evidence'],
];

grid.innerHTML = FACTS.map(([key, label]) => `<div class="risk-fact"><label for="fact-${escapeHtml(key)}">${escapeHtml(label)}</label><select id="fact-${escapeHtml(key)}" name="${escapeHtml(key)}"><option value="unknown">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></div>`).join('');

function card(item) {
  const entry = item.entry;
  const applicability = item.applicability;
  return `<article class="panel risk-library-card"><div class="finding-head"><span class="eyebrow">${escapeHtml(entry.category)}</span><span class="risk-status-pill ${escapeHtml(applicability.status)}">${escapeHtml(applicability.status.replaceAll('_', ' '))}</span></div><h2>${escapeHtml(entry.title)}</h2><p>${escapeHtml(entry.problem?.statement || '')}</p><p class="muted">${escapeHtml(applicability.reason || '')}</p><div class="button-row"><a class="button ghost small" href="/risk-library-detail.html?id=${encodeURIComponent(entry.id)}">Review control</a></div></article>`;
}
function factsFromForm() {
  return Object.fromEntries(FACTS.map(([key]) => {
    const value = form.elements[key].value;
    return [key, value === 'true' ? true : value === 'false' ? false : null];
  }));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Building the profile…';
  results.innerHTML = '';
  try {
    const facts = factsFromForm();
    latestFacts = facts;
    let items;
    try {
      const data = await api('/api/risk-knowledge/profile', { method: 'POST', body: JSON.stringify({ facts }) });
      items = Array.isArray(data.results) ? data.results : [];
    } catch {
      const response = await fetch('/risk-knowledge-public-v1.1.json', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('The risk profiler could not be loaded.');
      const data = await response.json();
      items = (data.entries || []).map((entry) => ({ entry, applicability: evaluateApplicability(entry, facts) }));
    }
    const applicable = items.filter((item) => item.applicability.status === 'applicable');
    const unknown = items.filter((item) => item.applicability.status === 'unknown');
    status.textContent = `${applicable.length} applicable and ${unknown.length} review-required risks. Unknown facts were not treated as safe.`;
    if (projectId) projectActions.innerHTML = `<section class="risk-access-box"><h2>Save this scope to the project</h2><p>This records applicability only. It does not mark controls as implemented or tested.</p><button id="saveRiskProfile" class="button primary" type="button">Save project risk scope</button></section>`;
    results.innerHTML = [...applicable, ...unknown].map(card).join('') || '<div class="panel risk-empty"><p>No applicable or review-required entries were returned.</p></div>';
  } catch (error) {
    status.textContent = error.message;
  }
});
projectActions.addEventListener('click', async (event) => {
  const button = event.target.closest('#saveRiskProfile');
  if (!button || !projectId || !latestFacts) return;
  setBusy(button, true, 'Saving…');
  try {
    const saved = await api(`/api/projects/${encodeURIComponent(projectId)}/risk-knowledge-profile`, { method: 'PUT', body: JSON.stringify({ facts: latestFacts }) });
    const summary = saved.summary || {};
    projectActions.innerHTML = `<section class="success-box"><strong>Project scope saved.</strong><p>${Number(summary.applicable || 0)} applicable controls and ${Number(summary.unknown || 0)} controls still require applicability review.</p><a class="button ghost small" href="/risk-readiness.html?projectId=${encodeURIComponent(projectId)}">Open evidence readiness</a></section>`;
  } catch (error) {
    setBusy(button, false);
    status.textContent = error.message;
  }
});
form.addEventListener('reset', () => { window.setTimeout(() => { latestFacts = null; status.textContent = ''; projectActions.innerHTML = ''; results.innerHTML = ''; }, 0); });
