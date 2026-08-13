import { api, escapeHtml as esc, qs } from './shared.js';

const projectId = qs('projectId');
const controlId = qs('controlId');
const root = document.querySelector('#ciControlRoot');
let rendering = false;

function message(text, error = false) {
  const box = document.querySelector('#ciMessage');
  if (!box) return;
  box.className = error ? 'error-box show' : 'success-box show';
  box.textContent = text;
  box.setAttribute('tabindex', '-1');
  box.focus({ preventScroll: true });
}

function openFinding(detail) {
  return detail.findings?.find((item) => !['verified_closed', 'accepted_risk'].includes(item.status)) || null;
}

function exactPassedRetest(detail, finding) {
  if (!finding) return null;
  const tests = [...(detail.tests || []), ...(detail.testHistory || [])];
  const failed = tests.find((item) => item.result === 'failed' && item.executionKind !== 'retest' && item.findingId === finding.id);
  if (!failed) return null;
  return tests.find((item) => item.executionKind === 'retest'
    && item.result === 'passed'
    && item.retestOfExecutionId === failed.id
    && item.findingId === finding.id
    && item.systemSnapshotId === detail.systemSnapshot?.id) || null;
}

function alreadyQualified(detail, retest) {
  return (detail.evidence || []).some((item) => item.testExecutionId === retest?.id
    && item.retentionStatus === 'active'
    && item.verificationState === 'verified');
}

async function render() {
  if (!root || !projectId || !controlId || rendering || document.querySelector('#redteamBindingForm')) return;
  const text = root.textContent || '';
  if (!/verify evidence for the passed exact retest|closure blocked/i.test(text)) return;
  rendering = true;
  try {
    const detail = await api(`/api/projects/${projectId}/control-intelligence/controls/${controlId}`);
    const finding = openFinding(detail);
    const retest = exactPassedRetest(detail, finding);
    if (detail.chain?.currentStage !== 'retest' || !finding || !retest || alreadyQualified(detail, retest)) return;
    const anchor = [...root.querySelectorAll('.ci-trust-note')].find((item) => /closure blocked/i.test(item.textContent || '')) || root.querySelector('.ci-focus-form');
    if (!anchor) return;
    const panel = document.createElement('section');
    panel.className = 'panel ci-redteam-binding';
    panel.innerHTML = `<div class="ci-action-copy"><span class="eyebrow">Retest evidence source</span><h3>Bind an uploaded Red Team baseline and retest.</h3><p>Use this only when the signed customer-operated runs represent the same exact attack before and after remediation. AgentRiskLayer verifies the uploaded bundle integrity and comparison; it does not independently operate the target.</p></div>
      <form id="redteamBindingForm" class="ci-form ci-focus-form">
        <label>Passed retest run ID<input id="redteamRetestRun" type="text" placeholder="rtr_…" required></label>
        <label>Failed baseline run ID<input id="redteamBaselineRun" type="text" placeholder="rtr_…" required></label>
        <label>Red Team case ID<input id="redteamCase" type="text" placeholder="RT-…" required></label>
        <label>Additional limitations<textarea id="redteamLimitations" placeholder="Optional scope or equivalence limitations"></textarea></label>
        <label class="ci-choice ci-confirm"><input id="redteamSnapshotConfirm" type="checkbox" required> I confirm these runs describe the same controlled test scenario and the current snapshot is the remediated version represented by this retest.</label>
        <label class="ci-choice ci-confirm"><input id="redteamTrustConfirm" type="checkbox" required> I understand the signature verifies bundle integrity and provenance, not independent operation or independent attestation of the target.</label>
        <button class="button primary button-xl" type="submit">Bind integrity-verified Red Team evidence</button>
      </form>
      <div class="ci-trust-note"><strong>Trust scope</strong><span>Successful binding is labelled <code>integrity_verified_customer_operated</code>. The assessment and snapshot association is explicitly confirmed by an authorised project admin/owner and retained in the evidence descriptor and audit log.</span></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    panel.querySelector('#redteamBindingForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      try {
        button.disabled = true;
        await api(`/api/projects/${projectId}/control-intelligence/controls/${controlId}/evidence`, {
          method: 'POST',
          body: JSON.stringify({
            systemSnapshotId: detail.systemSnapshot.id,
            testExecutionId: retest.id,
            findingId: finding.id,
            remediationId: finding.id,
            redteamRunId: document.querySelector('#redteamRetestRun').value.trim(),
            redteamBaselineRunId: document.querySelector('#redteamBaselineRun').value.trim(),
            redteamCaseId: document.querySelector('#redteamCase').value.trim(),
            confirmAssessmentBinding: document.querySelector('#redteamSnapshotConfirm').checked,
            confirmSnapshotBinding: document.querySelector('#redteamSnapshotConfirm').checked,
            confirmTrustBoundary: document.querySelector('#redteamTrustConfirm').checked,
            limitations: document.querySelector('#redteamLimitations').value.trim(),
          }),
        });
        message('Integrity-verified customer-operated Red Team evidence bound to the exact retest.');
        location.reload();
      } catch (error) {
        message(error.message, true);
        button.disabled = false;
      }
    });
  } catch {
    // The primary control page owns error rendering. This enhancement remains fail-closed and optional.
  } finally {
    rendering = false;
  }
}

const observer = new MutationObserver(render);
observer.observe(root || document.body, { childList: true, subtree: true });
render();
