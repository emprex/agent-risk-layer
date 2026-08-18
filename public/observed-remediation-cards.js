import { api, escapeHtml } from './shared.js';
import { remediationFindingKey } from './assessment-remediation.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
let busy = false;

function statusLabel(item) {
  const value = String(item?.status || 'open').replaceAll('_', ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function exactRetest(finding) {
  return `Run AgentRisk Inspector again against the exact assessed system version and confirm ${finding?.ruleId || 'this observed rule'} is no longer reported.`;
}

function observedCard(finding, remediation, { noLongerReproduced = false, latestInspection = null } = {}) {
  const title = finding?.title || finding?.ruleId || 'Observed finding';
  const ruleId = finding?.ruleId || 'Observed finding';
  const description = finding?.message || finding?.description || 'The authorised static inspection observed this condition in the assessed system.';
  const impact = ruleId === 'ARL-AI-006'
    ? 'Model-produced output can reach a tool or business action without an independent validation boundary.'
    : ruleId === 'ARL-AI-005'
      ? 'Agent execution can continue without explicit time, token, retry, tool-depth, concurrency or spend limits.'
      : 'The observed condition can weaken the control boundary described by this finding.';
  const whyItMatters = ruleId === 'ARL-AI-006'
    ? 'Malformed, hallucinated or attacker-influenced arguments can trigger the wrong refund, destination, parameters or other unintended business action.'
    : ruleId === 'ARL-AI-005'
      ? 'Runaway execution can create unexpected cost, service exhaustion, degraded availability or uncontrolled repeated tool activity.'
      : description;
  const inspectionClosed = remediation?.status === 'verified_closed'
    && remediation?.verification?.retestSourceType === 'inspection';
  const summaryAction = inspectionClosed ? 'Closure recorded' : noLongerReproduced ? 'Review retest' : 'Open fix';
  const evidenceText = inspectionClosed
    ? `An accountable reviewer accepted the bounded Inspector retest for ${ruleId}.`
    : noLongerReproduced
      ? `Latest authorised Inspector retest no longer reports ${ruleId}. This is bounded retest evidence to review, not automatic closure.`
      : `Latest authorised Inspector result · confidence ${finding?.confidence || 'unknown'}.`;
  const verification = inspectionClosed
    ? 'Closure applies to this exact static finding and assessed scope. It does not independently prove runtime behaviour, production equivalence or unrelated controls.'
    : noLongerReproduced
      ? 'The latest comparable inspection no longer reproduces this rule. Keep the remediation open until an accountable review accepts the bounded retest evidence and records closure.'
      : 'This remediation remains open until bounded retest evidence supports closure. Assignment or implementation alone is not verification.';
  const scanMeta = noLongerReproduced && latestInspection
    ? `<p><strong>Retest source</strong><br>Inspection ${escapeHtml(latestInspection.id || '')} · scanner ${escapeHtml(latestInspection.scannerVersion || 'unknown')} · policy ${escapeHtml(latestInspection.policyVersion || 'unknown')}.</p>`
    : '';
  const closureAction = noLongerReproduced && !inspectionClosed && latestInspection?.id
    ? `<div class="notice success observed-closure-review"><strong>Accountable closure review</strong><p>Accept only if this latest bounded static retest is the evidence you intend to rely on for this exact finding. This does not prove runtime behaviour or unrelated controls.</p><button class="button primary" type="button" data-accept-observed-retest data-remediation-id="${escapeHtml(remediation.id)}" data-inspection-id="${escapeHtml(latestInspection.id)}" data-rule-id="${escapeHtml(ruleId)}">Accept retest evidence and close finding</button><p class="error-box" data-observed-closure-error hidden></p></div>`
    : inspectionClosed
      ? `<div class="notice success"><strong>Verified closed</strong><br>Accountable closure review recorded against Inspector ${escapeHtml(remediation?.verification?.retestArtifactId || latestInspection?.id || '')}. Reassess if the model, tools, permissions, data, prompts or environment change.</div>`
      : '';
  return `<details class="remediation-row observed-remediation-card${noLongerReproduced ? ' observed-retest-ready' : ''}" data-remediation-id="${escapeHtml(remediation.id)}">
    <summary>
      <span class="status-pill">${escapeHtml(finding?.severity || remediation?.severity || 'medium')}</span>
      <span><strong>${escapeHtml(ruleId)} · ${escapeHtml(title)}</strong><small>${escapeHtml(inspectionClosed ? 'Verified closed' : noLongerReproduced ? 'Retest evidence available' : statusLabel(remediation))} · owner ${escapeHtml(remediation?.owner_email || 'unassigned')}</small></span>
      <span>${escapeHtml(summaryAction)}</span>
    </summary>
    <div class="remediation-body">
      <p><strong>What can happen</strong><br>${escapeHtml(impact)}</p>
      <p><strong>Why it matters</strong><br>${escapeHtml(whyItMatters)}</p>
      <p><strong>Observed evidence</strong><br>${escapeHtml(evidenceText)}</p>
      ${scanMeta}
      <p><strong>Fix</strong><br>${escapeHtml(finding?.remediation || remediation?.title || 'Remediate the observed weakness.')}</p>
      <p><strong>Owner</strong><br>${escapeHtml(remediation?.owner_email || 'Unassigned')}</p>
      <p><strong>Exact retest</strong><br>${escapeHtml(exactRetest(finding))}</p>
      <div class="notice"><strong>Verification rule</strong><br>${escapeHtml(verification)}</div>
      ${closureAction}
    </div>
  </details>`;
}

function remediationForFinding(remediations, finding) {
  const key = remediationFindingKey(assessmentId, {
    id: finding?.ruleId || finding?.title || 'observed-finding',
    title: finding?.title || finding?.ruleId || 'Observed finding',
  });
  return remediations.find((item) => item.finding_key === key) || null;
}

function ruleWasResolved(delta, ruleId) {
  if (!ruleId) return false;
  return (delta?.resolvedFindings || []).some((key) => String(key || '').startsWith(`${ruleId}:`));
}

function bindObservedClosureActions(container, projectId) {
  container.querySelectorAll('[data-accept-observed-retest]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const remediationId = button.dataset.remediationId || '';
      const inspectionId = button.dataset.inspectionId || '';
      const ruleId = button.dataset.ruleId || '';
      const errorBox = button.parentElement?.querySelector('[data-observed-closure-error]');
      button.disabled = true;
      button.textContent = 'Recording closure…';
      if (errorBox) {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/remediations/${encodeURIComponent(remediationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'verified_closed',
            verification: { observedInspectionClosure: { inspectionId, ruleId } },
          }),
        });
        location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Accept retest evidence and close finding';
        if (errorBox) {
          errorBox.hidden = false;
          errorBox.classList.add('show');
          errorBox.textContent = error?.message || 'Could not record the closure review.';
        }
      }
    });
  });
}

async function renderObservedRemediations() {
  if (!assessmentId || busy) return;
  const list = document.querySelector('.remediation-plan-list');
  if (!list) return;
  busy = true;
  try {
    const projectId = sessionStorage.getItem('arl_selected_project') || '';
    if (!projectId) return;
    const [{ inspections = [] }, { project }] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`),
      api(`/api/projects/${encodeURIComponent(projectId)}`),
    ]);
    const latest = inspections[0];
    if (!latest?.id) return;
    const { inspection } = await api(`/api/inspections/${encodeURIComponent(latest.id)}`);
    const currentFindings = (inspection?.findings || []).filter((item) => item?.review?.status !== 'false-positive');
    const remediations = (project?.remediations || []).filter((item) => item?.assessment_id === assessmentId);

    const currentPairs = currentFindings.map((finding) => ({
      finding,
      remediation: remediationForFinding(remediations, finding),
      noLongerReproduced: false,
    })).filter((item) => item.remediation);

    let resolvedPairs = [];
    const baselineInspectionId = inspection?.delta?.baselineInspectionId || latest?.delta?.baselineInspectionId || '';
    if (baselineInspectionId && (inspection?.delta?.resolvedFindings || latest?.delta?.resolvedFindings || []).length) {
      const { inspection: baseline } = await api(`/api/inspections/${encodeURIComponent(baselineInspectionId)}`);
      const delta = inspection?.delta || latest?.delta || {};
      resolvedPairs = (baseline?.findings || [])
        .filter((finding) => finding?.review?.status !== 'false-positive' && ruleWasResolved(delta, finding?.ruleId))
        .map((finding) => ({
          finding,
          remediation: remediationForFinding(remediations, finding),
          noLongerReproduced: true,
        }))
        .filter((item) => item.remediation && !currentPairs.some((current) => current.remediation.id === item.remediation.id));
    }

    const pairs = [...currentPairs, ...resolvedPairs];
    if (!pairs.length) return;

    const signature = `${latest.id}:${pairs.map((item) => `${item.remediation.id}:${item.noLongerReproduced ? 'resolved' : 'active'}:${item.remediation.status}`).join(',')}`;
    if (list.dataset.observedRemediationCards === signature) return;
    list.dataset.observedRemediationCards = signature;

    const heading = list.querySelector('.section-heading');
    if (!heading) return;
    [...list.children].forEach((child) => { if (child !== heading) child.remove(); });
    const container = document.createElement('div');
    container.className = 'remediation-list observed-remediation-list';
    container.innerHTML = pairs.map(({ finding, remediation, noLongerReproduced }) => observedCard(
      finding,
      remediation,
      { noLongerReproduced, latestInspection: latest },
    )).join('');
    list.appendChild(container);
    bindObservedClosureActions(container, projectId);
  } catch {
    // The core Findings page remains usable if evidence detail cannot be loaded.
  } finally {
    busy = false;
  }
}

if (assessmentId) {
  void renderObservedRemediations();
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void renderObservedRemediations();
    });
  });
  observer.observe(document.querySelector('#controlPlaneRoot') || document.body, { childList: true, subtree: true });
}
