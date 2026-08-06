import { api, escapeHtml, qs } from './shared.js';
import { severityPresentation } from './risk-knowledge-core.js';

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
      <article class="risk-readiness-metric"><strong>${summary.declaredControls || 0}</strong><span>Declared controls</span></article>
      <article class="risk-readiness-metric"><strong>${summary.observedControls || 0}</strong><span>Observed controls</span></article>
      <article class="risk-readiness-metric"><strong>${summary.testedControls || 0}</strong><span>Tested controls</span></article>
      <article class="risk-readiness-metric"><strong>${summary.unknown || 0}</strong><span>Needs applicability review</span></article>
      <article class="risk-readiness-metric"><strong>${summary.openFindings || 0}</strong><span>Open findings</span></article>
      <article class="risk-readiness-metric"><strong>${summary.failedCriticalGates || 0}</strong><span>Failed critical gates</span></article>
      <article class="risk-readiness-metric"><strong>${summary.remediationInProgress || 0}</strong><span>Remediation in progress</span></article>
      <article class="risk-readiness-metric"><strong>${summary.retestsPassed || 0}</strong><span>Retests passed</span></article>
      <article class="risk-readiness-metric"><strong>${summary.expiredEvidence || 0}</strong><span>Expired evidence</span></article>
      <article class="risk-readiness-metric"><strong>${summary.residualRisks || 0}</strong><span>Residual risks accepted</span></article>
    </section>
    <section class="panel"><span class="eyebrow">Current decision support</span><h2>Deployment decision: ${escapeHtml(human(summary.deploymentDecision || 'review_required'))}</h2><p>The server derives this from applicability, authoritative evidence links, open findings, critical blockers, remediation, retests, accepted residual risks and expiry. It is not a checkbox score, certification, compliance declaration or probability of breach.</p><div class="button-row"><a class="button ghost small" href="/risk-profiler.html?projectId=${encodeURIComponent(projectId)}">Update architecture profile</a><a class="button ghost small" href="/control-plane.html">Open project control plane</a></div></section>
    <section class="panel"><h2>Control states</h2>${states.length ? `<div class="risk-table-wrap"><table><thead><tr><th>Control</th><th>Severity</th><th>Applicability</th><th>Evidence</th><th>Gate</th><th>Evidence count</th></tr></thead><tbody>${states.map((state) => `<tr><td><a href="/risk-library-detail.html?id=${encodeURIComponent(state.entryId)}">${escapeHtml(state.title)}</a></td><td>${escapeHtml(severityPresentation(state, { project: true }))}</td><td>${escapeHtml(human(state.applicabilityStatus))}</td><td>${escapeHtml(human(state.evidenceState))}</td><td>${escapeHtml(human(state.deploymentGate))}</td><td>${Number(state.evidenceCount) || 0}</td></tr>`).join('')}</tbody></table></div>` : '<div class="risk-empty"><p>No risk-knowledge states have been recorded for this project yet.</p><a class="button ghost" href="/risk-profiler.html">Build an applicability profile</a></div>'}</section>`;
  } catch (error) {
    root.className = 'error-box show';
    root.textContent = error.message;
  }
})();
