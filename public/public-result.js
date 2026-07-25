import { api, escapeHtml, qs, riskClass } from './shared.js';
const root = document.querySelector('#sharedRoot');
async function init() {
  try {
    const { assessment } = await api(`/api/public/${encodeURIComponent(qs('token') || '')}`);
    const color = assessment.score >= 75 ? 'var(--red)' : assessment.score >= 50 ? 'var(--orange)' : assessment.score >= 25 ? 'var(--yellow)' : 'var(--green)';
    root.className = '';
    root.innerHTML = `<div class="result-grid"><aside class="panel result-score"><span class="eyebrow">Shared assessment</span><div class="score-ring ${riskClass(assessment.riskBand)}"><strong>${assessment.score}<small>/100</small></strong></div><div class="risk-pill ${riskClass(assessment.riskBand)}">${escapeHtml(assessment.riskBand)} risk</div><h2>${escapeHtml(assessment.name)}</h2><p class="muted">${escapeHtml(assessment.agentType)}</p><img alt="AgentRiskLayer assessment badge" src="/badge/${encodeURIComponent(assessment.shareToken)}.svg"><a class="button primary full" href="/assessment.html">Assess your own agent</a></aside><section><div class="panel"><h1 class="result-headline">${escapeHtml(assessment.headline)}</h1><p class="muted">${escapeHtml(assessment.methodology)}</p></div><div class="panel"><h2>Top findings</h2><div class="finding-list">${assessment.topFindings.map((f) => `<article class="finding"><div class="finding-head"><h4>${escapeHtml(f.title)}</h4><span class="severity ${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span></div><p>${escapeHtml(f.observed)}</p></article>`).join('')}</div></div><div class="panel"><h2>Control coverage</h2><div class="control-grid">${assessment.controls.map((c) => `<div class="control ${c.status}">${escapeHtml(c.name)}</div>`).join('')}</div></div></section></div>`;
  } catch (error) { root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`; }
}
init();
