import { api, escapeHtml, qs, riskClass } from './shared.js';

const root = document.querySelector('#sharedRoot');

async function init() {
  try {
    const { assessment } = await api(`/api/public/${encodeURIComponent(qs('token') || '')}`);
    const scoreAvailable = assessment.riskBand !== 'Undetermined';
    const findings = assessment.topFindings || [];
    const controls = assessment.controls || [];
    root.className = '';
    root.innerHTML = `<div class="result-grid">
      <aside class="panel result-score">
        <span class="eyebrow">Shared assessment</span>
        <div class="score-ring ${scoreAvailable ? riskClass(assessment.riskBand) : ''}"><strong>${scoreAvailable ? `${assessment.score}<small>/100</small>` : '—'}</strong></div>
        <div class="risk-pill ${scoreAvailable ? riskClass(assessment.riskBand) : ''}">${scoreAvailable ? `${escapeHtml(assessment.riskBand)} declared risk` : 'Assessment incomplete'}</div>
        <h2>${escapeHtml(assessment.name)}</h2>
        <p class="muted">${escapeHtml(assessment.agentType)}</p>
        ${scoreAvailable ? `<img alt="AgentRiskLayer assessment badge" src="/badge/${encodeURIComponent(assessment.shareToken)}.svg">` : '<p class="microcopy">No risk score or badge is shown while material security information is unresolved.</p>'}
        <a class="button primary full" href="/assessment.html">Assess your own agent</a>
      </aside>
      <section>
        <div class="panel"><h1 class="result-headline">${escapeHtml(assessment.headline)}</h1><p class="muted">${escapeHtml(assessment.methodology)}</p></div>
        <div class="panel"><h2>${findings.length ? 'Top declared findings' : 'Findings'}</h2><div class="finding-list">${findings.length ? findings.map((f) => `<article class="finding"><div class="finding-head"><h4>${escapeHtml(f.title)}</h4>${f.severity ? `<span class="severity ${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span>` : ''}</div><p>${escapeHtml(f.observed || 'See the assessment owner for details.')}</p></article>`).join('') : '<p>No declared control weakness is shown in this public summary. Missing information or evidence may still prevent a deployment decision.</p>'}</div></div>
        <div class="panel"><h2>Control coverage</h2><div class="control-grid">${controls.map((c) => `<div class="control ${escapeHtml(c.status)}">${escapeHtml(c.name)}${c.status === 'unresolved' ? '<small>Information required</small>' : ''}</div>`).join('')}</div></div>
      </section>
    </div>`;
  } catch (error) {
    root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

init();
