import { api, escapeHtml, qs } from './shared.js';

const root = document.querySelector('#readinessRoot');
function human(value) { return String(value || '').replaceAll('_', ' '); }

(async () => {
  try {
    const projectId = qs('projectId');
    if (!projectId) throw new Error('Open evidence readiness from a project so the project identifier is bound by the server.');
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}/risk-knowledge-readiness`);
    const summary = data.summary || {};
    const states = Array.isArray(data.states) ? data.states : [];
    root.className = '';
    root.innerHTML = `<section class="risk-readiness-grid">
      <article class="risk-readiness-metric"><strong>${summary.applicable || 0}</strong><span>Applicable</span></article>
      <article class="risk-readiness-metric"><strong>${summary.unknown || 0}</strong><span>Needs applicability review</span></article>
      <article class="risk-readiness-metric"><strong>${summary.openFindings || 0}</strong><span>Open findings</span></article>
      <article class="risk-readiness-metric"><strong>${summary.failedCriticalGates || 0}</strong><span>Failed critical gates</span></article>
    </section>
    <section class="panel"><span class="eyebrow">Current decision support</span><h2>Deployment gate: ${escapeHtml(human(summary.deploymentGate || 'review_required'))}</h2><p>This is a derived evidence state, not a certification, compliance declaration or probability of breach.</p><div class="button-row"><a class="button ghost small" href="/risk-profiler.html?projectId=${encodeURIComponent(projectId)}">Update architecture profile</a><a class="button ghost small" href="/control-plane.html">Open project control plane</a></div></section>
    <section class="panel"><h2>Control states</h2>${states.length ? `<div class="risk-table-wrap"><table><thead><tr><th>Control</th><th>Severity</th><th>Applicability</th><th>Evidence</th><th>Gate</th><th>Evidence count</th></tr></thead><tbody>${states.map((state) => `<tr><td><a href="/risk-library-detail.html?id=${encodeURIComponent(state.entryId)}">${escapeHtml(state.title)}</a></td><td>${escapeHtml(state.severity)}</td><td>${escapeHtml(human(state.applicabilityStatus))}</td><td>${escapeHtml(human(state.evidenceState))}</td><td>${escapeHtml(human(state.deploymentGate))}</td><td>${Number(state.evidenceCount) || 0}</td></tr>`).join('')}</tbody></table></div>` : '<div class="risk-empty"><p>No risk-knowledge states have been recorded for this project yet.</p><a class="button ghost" href="/risk-profiler.html">Build an applicability profile</a></div>'}</section>`;
  } catch (error) {
    root.className = 'error-box show';
    root.textContent = error.message;
  }
})();
