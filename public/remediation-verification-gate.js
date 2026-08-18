import { api, escapeHtml } from './shared.js';
import { remediationFindingKey } from './assessment-remediation.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';
let observedPromise = null;
let applyInFlight = false;

function assessmentEvidenceHref() {
  const query = new URLSearchParams();
  if (assessmentId) query.set('assessment', assessmentId);
  if (token) query.set('token', token);
  return `/inspector.html${query.toString() ? `?${query.toString()}` : ''}`;
}

export function verificationGateCopy(count) {
  const total = Number(count) || 0;
  return {
    eyebrow: 'Verify before fixing',
    title: total === 1 ? 'Verify this assessment concern first' : `Verify these ${total} assessment concerns first`,
    body: 'These items came from assessment answers. They are not confirmed findings yet, so AgentRiskLayer will not create remediation fixes until observed or reproducible evidence supports a failure.',
    action: 'Go to Evidence and verify',
  };
}

function concernCount(root) {
  const scope = root?.querySelector('.assessment-scope-banner');
  const match = scope?.textContent?.match(/\b(\d+)\s+of\s+(\d+)\b/i);
  return match ? Number(match[2]) : 0;
}

function normaliseObservedFinding(item) {
  return {
    id: item?.ruleId || item?.title || 'observed-finding',
    title: item?.title || item?.ruleId || 'Observed finding',
    severity: item?.severity || 'medium',
    recommendation: item?.remediation || 'Remediate the observed weakness and retest the exact condition.',
    verification: `Run AgentRisk Inspector again against the exact assessed system version and confirm ${item?.ruleId || 'the observed rule'} is no longer reported.`,
    confidence: item?.confidence || 'unknown',
    evidenceClass: 'locally-observed-static-evidence',
  };
}

async function loadObservedContext() {
  if (!observedPromise) {
    observedPromise = (async () => {
      const { inspections = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`);
      const latest = inspections[0];
      if (!latest?.id || Number(latest.summary?.activeFindingsTotal || latest.summary?.findingsTotal || 0) <= 0) {
        return { inspection: null, findings: [] };
      }
      const { inspection } = await api(`/api/inspections/${encodeURIComponent(latest.id)}`);
      const findings = (inspection?.findings || [])
        .filter((item) => item?.review?.status !== 'false-positive')
        .map(normaliseObservedFinding);
      return { inspection, findings };
    })().catch(() => ({ inspection: null, findings: [] }));
  }
  return observedPromise;
}

function updateHeading(root, observed) {
  const heading = root.querySelector('#remediation .section-heading');
  const headingEyebrow = heading?.querySelector('.eyebrow');
  const headingTitle = heading?.querySelector('h2');
  const headingText = heading?.querySelector('p');
  if (observed) {
    if (headingEyebrow) headingEyebrow.textContent = 'Observed finding → fix';
    if (headingTitle) headingTitle.textContent = 'Fix evidence-backed weaknesses, then retest.';
    if (headingText) headingText.textContent = 'Only findings observed by the latest inspection are eligible here. Assessment concerns remain separate until supported by evidence.';
  } else {
    if (headingEyebrow) headingEyebrow.textContent = 'Verify, then fix';
    if (headingTitle) headingTitle.textContent = 'Establish the finding before remediation.';
    if (headingText) headingText.textContent = 'Assessment answers identify concerns. Evidence establishes whether a weakness is real; only confirmed findings should become fixes.';
  }
}

function updatePlanListCopy(root, observed) {
  const list = root.querySelector('.remediation-plan-list');
  if (!list) return;
  const title = list.querySelector('h3');
  const text = list.querySelector('p');
  if (title) title.textContent = observed ? 'Observed remediation plan' : 'Confirmed remediation plan';
  if (text) text.textContent = observed
    ? 'Only evidence-backed findings from this assessment are tracked here.'
    : 'Confirmed findings will appear here after verification. Assessment concerns are not fixes.';
}

function updateScope(root, total, assigned, observed) {
  const scope = root.querySelector('.assessment-scope-banner');
  if (!scope) return;
  const summary = scope.querySelector('div:nth-child(2)');
  if (summary) {
    const strong = summary.querySelector('strong');
    const span = summary.querySelector('span');
    const small = summary.querySelector('small');
    if (strong) strong.textContent = `${assigned} of ${total}`;
    if (span) span.textContent = observed ? 'observed fixes assigned' : 'confirmed fixes assigned';
    if (small) small.textContent = observed
      ? `${Math.max(0, total - assigned)} observed finding${total - assigned === 1 ? '' : 's'} remaining`
      : `${total} concern${total === 1 ? '' : 's'} to verify`;
  }
}

async function observedLinkedState(findings) {
  const projectId = sessionStorage.getItem('arl_selected_project') || '';
  if (!projectId) return { projectId: '', linkedKeys: new Set() };
  try {
    const { project } = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    const linkedKeys = new Set((project?.remediations || [])
      .filter((item) => item?.assessment_id === assessmentId)
      .map((item) => item.finding_key));
    return { projectId, linkedKeys };
  } catch {
    return { projectId: '', linkedKeys: new Set() };
  }
}

function findingPreview(findings) {
  return findings.map((finding) => `
    <li>
      <span class="status-pill">${escapeHtml(finding.severity)}</span>
      <div><strong>${escapeHtml(finding.id)} · ${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.recommendation)}</small><small>Observed evidence · confidence ${escapeHtml(finding.confidence)}</small></div>
    </li>`).join('');
}

async function renderObservedPlan(root, planning, observed) {
  const { projectId, linkedKeys } = await observedLinkedState(observed.findings);
  if (!projectId) return false;

  const keyed = observed.findings.map((finding) => ({
    finding,
    key: remediationFindingKey(assessmentId, finding),
  }));
  const remaining = keyed.filter((item) => !linkedKeys.has(item.key));
  const assigned = keyed.length - remaining.length;
  const signature = `${observed.inspection?.id || 'inspection'}:${assigned}:${remaining.length}`;
  if (planning.dataset.verificationGate === signature) return false;
  planning.dataset.verificationGate = signature;

  updateHeading(root, true);
  updatePlanListCopy(root, true);
  updateScope(root, keyed.length, assigned, true);

  if (!remaining.length) {
    planning.innerHTML = `
      <span class="eyebrow">Observed findings assigned</span>
      <h3>All ${keyed.length} evidence-backed finding${keyed.length === 1 ? '' : 's'} now have remediation records.</h3>
      <p>Assignment records responsibility only. The findings remain open until the fix is implemented and the exact retest no longer reproduces the observed condition.</p>
      <div class="notice"><strong>Next action</strong><br>Open the first remediation item below, implement the fix, then rerun Inspector against the same assessed system version.</div>`;
    return true;
  }

  planning.innerHTML = `
    <span class="eyebrow">Observed findings ready to fix</span>
    <h3>Create remediation for ${remaining.length} evidence-backed finding${remaining.length === 1 ? '' : 's'}</h3>
    <p>These items come from the latest uploaded inspection, not from assessment declarations. Creating the plan records ownership only; it does not claim the fix is implemented or verified.</p>
    <form id="observedRemediationForm" class="auth-form">
      <div class="field"><label for="observedRemediationOwner">Who will coordinate these fixes?</label><input id="observedRemediationOwner" type="email" required autocomplete="email" placeholder="Example: security@company.com"><small>Applied only to the observed findings listed below.</small></div>
      <details class="plan-review" open><summary>Review ${remaining.length} observed finding${remaining.length === 1 ? '' : 's'}</summary><ol>${findingPreview(remaining.map((item) => item.finding))}</ol></details>
      <button class="button primary" type="submit">Assign ${remaining.length} observed fix${remaining.length === 1 ? '' : 'es'}</button>
    </form>`;

  planning.querySelector('#observedRemediationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ownerEmail = planning.querySelector('#observedRemediationOwner')?.value.trim() || '';
    if (!ownerEmail) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Assigning…';
    try {
      for (const item of remaining) {
        await api(`/api/projects/${encodeURIComponent(projectId)}/remediations`, {
          method: 'POST',
          body: JSON.stringify({
            title: item.finding.recommendation,
            severity: item.finding.severity,
            ownerEmail,
            assessmentId,
            findingKey: item.key,
          }),
        });
      }
      location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = `Assign ${remaining.length} observed fix${remaining.length === 1 ? '' : 'es'}`;
      alert(error.message);
    }
  });
  return true;
}

function renderVerificationGate(root, planning) {
  const scope = root.querySelector('.assessment-scope-banner');
  if (!scope || !/\b0\s+of\s+\d+\b/i.test(scope.textContent || '')) return false;
  const count = concernCount(root);
  if (!count) return false;
  if (planning.dataset.verificationGate === 'verify') return false;
  planning.dataset.verificationGate = 'verify';
  const copy = verificationGateCopy(count);
  planning.innerHTML = `
    <span class="eyebrow">${copy.eyebrow}</span>
    <h3>${copy.title}</h3>
    <p>${copy.body}</p>
    <div class="notice"><strong>Next action</strong><br>Collect observed evidence or run a bounded test. Only a supported failure becomes eligible for remediation.</div>
    <a class="button primary" href="${assessmentEvidenceHref()}">${copy.action}</a>`;
  updateHeading(root, false);
  updatePlanListCopy(root, false);
  updateScope(root, count, 0, false);
  return true;
}

async function applyGate(root) {
  if (!root || applyInFlight) return false;
  const planning = root.querySelector('.remediation-plan-card');
  if (!planning) return false;
  applyInFlight = true;
  try {
    const observed = await loadObservedContext();
    if (observed.findings.length) return renderObservedPlan(root, planning, observed);
    return renderVerificationGate(root, planning);
  } finally {
    applyInFlight = false;
  }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined' && assessmentId) {
  const root = document.querySelector('#controlPlaneRoot');
  if (root) {
    void applyGate(root);
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        void applyGate(root);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }
}
