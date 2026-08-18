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
    ? 'Malformed, hallucinated or attacker-influenced model output can reach a tool or business action and trigger unintended parameters or actions.'
    : ruleId === 'ARL-AI-005'
      ? 'Unbounded agent execution can cause runaway cost, degraded service or uncontrolled retries and tool activity.'
      : 'The observed condition can weaken the control boundary described by this finding.';
  const summaryAction = noLongerReproduced ? 'Review retest' : 'Open fix';
  const evidenceText = noLongerReproduced
    ? `Latest authorised Inspector retest no longer reports ${ruleId}. This is bounded retest evidence to review, not automatic closure.`
    : `Latest authorised Inspector result · confidence ${finding?.confidence || 'unknown'}.`;
  const verification = noLongerReproduced
    ? 'The latest comparable inspection no longer reproduces this rule. Keep the remediation open until an accountable review accepts the bounded retest evidence and records closure.'
    : 'This remediation remains open until bounded retest evidence supports closure. Assignment or implementation alone is not verification.';
  const scanMeta = noLongerReproduced && latestInspection
    ? `<p><strong>Retest source</strong><br>Inspection ${escapeHtml(latestInspection.id || '')} · scanner ${escapeHtml(latestInspection.scannerVersion || 'unknown')} · policy ${escapeHtml(latestInspection.policyVersion || 'unknown')}.</p>`
    : '';
  return `<details class="remediation-row observed-remediation-card${noLongerReproduced ? ' observed-retest-ready' : ''}" data-remediation-id="${escapeHtml(remediation.id)}">
    <summary>
      <span class="status-pill">${escapeHtml(finding?.severity || remediation?.severity || 'medium')}</span>
      <span><strong>${escapeHtml(ruleId)} · ${escapeHtml(title)}</strong><small>${escapeHtml(noLongerReproduced ? 'Retest evidence available' : statusLabel(remediation))} · owner ${escapeHtml(remediation?.owner_email || 'unassigned')}</small></span>
      <span>${escapeHtml(summaryAction)}</span>
    </summary>
    <div class="remediation-body">
      <p><strong>What can happen</strong><br>${escapeHtml(impact)}</p>
      <p><strong>Why it matters</strong><br>${escapeHtml(impact)}</p>
      <p><strong>Observed evidence</strong><br>${escapeHtml(evidenceText)}</p>
      ${scanMeta}
      <p><strong>Fix</strong><br>${escapeHtml(finding?.remediation || remediation?.title || 'Remediate the observed weakness.')}</p>
      <p><strong>Owner</strong><br>${escapeHtml(remediation?.owner_email || 'Unassigned')}</p>
      <p><strong>Exact retest</strong><br>${escapeHtml(exactRetest(finding))}</p>
      <div class="notice"><strong>Verification rule</strong><br>${escapeHtml(verification)}</div>
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

    const signature = `${latest.id}:${pairs.map((item) => `${item.remediation.id}:${item.noLongerReproduced ? 'resolved' : 'active'}`).join(',')}`;
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
