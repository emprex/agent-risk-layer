import { api, escapeHtml } from './shared.js';
import { remediationFindingKey } from './assessment-remediation.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const source = params.get('source') || '';
const caseId = (params.get('case') || '').trim().toUpperCase();
const planId = params.get('plan') || '';
const baselineRunId = params.get('baseline') || '';
const expectedRoe = params.get('roe') || '';
let applyInFlight = false;
let evidencePromise = null;

function active() {
  return source === 'redteam' && assessmentId && caseId && baselineRunId;
}

function exactRetestHref(run) {
  const query = new URLSearchParams({ assessment: assessmentId, case: caseId, plan: planId || 'bounded-check', retest: '1', baseline: run.id });
  if (run.authorisationId) query.set('roe', run.authorisationId);
  return `/redteam.html?${query.toString()}`;
}

function evidenceHref() {
  return `/inspector.html?assessment=${encodeURIComponent(assessmentId)}`;
}

function failedCase(run) {
  if (!run || run.assessmentId !== assessmentId) return null;
  if (run.signatureValid !== true) return null;
  if (run.trust?.evidenceClass !== 'customer-operated-controlled-adversarial-test') return null;
  if (run.campaign?.target?.mode !== 'staging-adapter') return null;
  if (!['local','test','staging'].includes(String(run.campaign?.environment || ''))) return null;
  if (!run.authorisationId) return null;
  if (expectedRoe && run.authorisationId !== expectedRoe) return null;
  const results = (run.results || []).filter((item) => String(item.caseId || '').toUpperCase() === caseId);
  if (!results.length || !results.some((item) => item.outcome === 'failed')) return null;
  const failed = results.find((item) => item.outcome === 'failed');
  return {
    id: `redteam-${caseId}`,
    title: failed.title || caseId,
    severity: failed.severity || 'medium',
    recommendation: failed.remediation || 'Remediate the reproduced failure and rerun the exact bounded case.',
    verification: `Rerun ${caseId} under the same Rules of Engagement, target and policy version. The request fingerprint must match the reproduced failed baseline and the retest must pass.`,
    evidenceClass: 'customer-operated-controlled-adversarial-test',
    confidence: failed.confidence || 'unknown',
    run,
    result: failed,
  };
}

async function loadEvidence() {
  if (!evidencePromise) {
    evidencePromise = api(`/api/redteam/runs/${encodeURIComponent(baselineRunId)}`)
      .then((payload) => failedCase(payload.run))
      .catch(() => null);
  }
  return evidencePromise;
}

async function selectedProject() {
  const projectId = sessionStorage.getItem('arl_selected_project') || '';
  if (!projectId) return null;
  try {
    return (await api(`/api/projects/${encodeURIComponent(projectId)}`)).project || null;
  } catch {
    return null;
  }
}

function existingRemediation(project, finding) {
  const key = remediationFindingKey(assessmentId, finding);
  return (project?.remediations || []).find((item) => item.assessment_id === assessmentId && item.finding_key === key) || null;
}

function evidenceFacts(finding) {
  const run = finding.run;
  return `<div class="plain-finding-sections">
    <div><small>What can happen</small><p>${escapeHtml(finding.title)} was reproduced by the authorised bounded case <code>${escapeHtml(caseId)}</code>.</p></div>
    <div><small>Why it matters</small><p>Severity ${escapeHtml(finding.severity)}. A reproduced failure is evidence-backed and must be handled separately from questionnaire concerns.</p></div>
    <div><small>Evidence</small><p>Run <code>${escapeHtml(run.id)}</code> · ROE <code>${escapeHtml(run.authorisationId)}</code> · confidence ${escapeHtml(finding.confidence)}.</p></div>
    <div><small>Fix</small><p>${escapeHtml(finding.recommendation)}</p></div>
    <div><small>Exact retest</small><p>${escapeHtml(finding.verification)}</p></div>
  </div>`;
}

async function renderGate(root, planning, finding, project) {
  const existing = existingRemediation(project, finding);
  const key = remediationFindingKey(assessmentId, finding);
  const signature = `${baselineRunId}:${caseId}:${existing?.id || 'new'}`;
  if (planning.dataset.redteamRemediationGate === signature) return false;
  planning.dataset.redteamRemediationGate = signature;

  const heading = root.querySelector('#remediation .section-heading');
  if (heading?.querySelector('.eyebrow')) heading.querySelector('.eyebrow').textContent = 'Confirmed Red Team finding → fix';
  if (heading?.querySelector('h2')) heading.querySelector('h2').textContent = 'Fix the reproduced failure, then retest the exact case.';
  if (heading?.querySelector('p')) heading.querySelector('p').textContent = 'This item is eligible for remediation because an authorised bounded test reproduced a failure. Assignment is not implementation, and implementation is not verification.';

  if (existing) {
    planning.innerHTML = `
      <span class="eyebrow">Confirmed Red Team finding assigned</span>
      <h3>${escapeHtml(caseId)} · ${escapeHtml(finding.title)}</h3>
      ${evidenceFacts(finding)}
      <div class="success-box"><strong>Remediation owner recorded.</strong><p>This records responsibility only. The finding remains open until implementation evidence exists and the exact bounded retest passes.</p></div>
      <div class="workspace-next-action"><small>Next action</small><strong>Implement the fix and preserve implementation evidence.</strong><p>After implementation, rerun the same case under the same active Rules of Engagement.</p><a class="button primary small" href="${exactRetestHref(finding.run)}">Prepare exact retest</a></div>
      <a class="button ghost small" href="${evidenceHref()}">Back to Evidence Plan</a>`;
    return true;
  }

  planning.innerHTML = `
    <span class="eyebrow">Confirmed Red Team finding</span>
    <h3>${escapeHtml(caseId)} · ${escapeHtml(finding.title)}</h3>
    <p>This is a reproduced authorised test failure, not a declaration or inconclusive result. It can now enter remediation.</p>
    ${evidenceFacts(finding)}
    <form id="redteamRemediationForm" class="auth-form">
      <div class="field"><label for="redteamRemediationOwner">Who owns this fix?</label><input id="redteamRemediationOwner" type="email" required autocomplete="email" placeholder="Example: security@company.com"><small>The accountable owner for completing this confirmed fix.</small></div>
      <button class="button primary" type="submit">Assign confirmed fix</button>
    </form>
    <p class="microcopy">Creating this remediation records ownership only. It does not claim the fix is implemented or verified.</p>
    <a class="button ghost small" href="${evidenceHref()}">Back to Evidence Plan</a>`;

  planning.querySelector('#redteamRemediationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ownerEmail = planning.querySelector('#redteamRemediationOwner')?.value.trim() || '';
    if (!ownerEmail) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Assigning…';
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/remediations`, {
        method: 'POST',
        body: JSON.stringify({
          title: finding.recommendation,
          severity: finding.severity,
          ownerEmail,
          assessmentId,
          findingKey: key,
        }),
      });
      location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Assign confirmed fix';
      alert(error.message);
    }
  });
  return true;
}

async function apply(root) {
  if (!active() || !root || applyInFlight) return false;
  const planning = root.querySelector('.remediation-plan-card, .remediation-complete-card');
  if (!planning) return false;
  applyInFlight = true;
  try {
    const [finding, project] = await Promise.all([loadEvidence(), selectedProject()]);
    if (!finding) {
      if (planning.dataset.redteamRemediationGate !== 'invalid') {
        planning.dataset.redteamRemediationGate = 'invalid';
        planning.innerHTML = `<span class="eyebrow">Red Team evidence check</span><h3>Confirmed failure could not be validated</h3><p>The supplied run is missing, does not belong to this assessment, is not authorised adapter evidence, or the selected case is not a reproduced failure.</p><a class="button primary" href="${evidenceHref()}">Return to Evidence Plan</a>`;
      }
      return true;
    }
    if (!project) return false;
    return await renderGate(root, planning, finding, project);
  } finally {
    applyInFlight = false;
  }
}

if (active()) {
  const root = document.querySelector('#controlPlaneRoot');
  if (root) {
    void apply(root);
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; void apply(root); });
    });
    observer.observe(root, { childList: true, subtree: true });
  }
}
