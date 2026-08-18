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

function observedCard(finding, remediation) {
  const title = finding?.title || finding?.ruleId || 'Observed finding';
  const ruleId = finding?.ruleId || 'Observed finding';
  const description = finding?.message || finding?.description || 'The latest authorised static inspection observed this condition in the assessed system.';
  const impact = ruleId === 'ARL-AI-006'
    ? 'Model-produced output can reach a tool or business action without an independent validation boundary, so malformed or unsafe arguments may be executed.'
    : ruleId === 'ARL-AI-005'
      ? 'Without explicit resource limits, an agent can consume more time, tokens, retries, tool calls or spend than intended.'
      : 'The observed condition can weaken the control boundary described by this finding.';
  return `<details class="remediation-row observed-remediation-card" data-remediation-id="${escapeHtml(remediation.id)}">
    <summary>
      <span class="status-pill">${escapeHtml(finding?.severity || remediation?.severity || 'medium')}</span>
      <span><strong>${escapeHtml(ruleId)} · ${escapeHtml(title)}</strong><small>${escapeHtml(statusLabel(remediation))} · owner ${escapeHtml(remediation?.owner_email || 'unassigned')}</small></span>
      <span>Open fix</span>
    </summary>
    <div class="remediation-body">
      <p><strong>What can happen</strong><br>${escapeHtml(impact)}</p>
      <p><strong>Why it matters</strong><br>${escapeHtml(description)}</p>
      <p><strong>Observed evidence</strong><br>Latest authorised Inspector result · confidence ${escapeHtml(finding?.confidence || 'unknown')}.</p>
      <p><strong>Fix</strong><br>${escapeHtml(finding?.remediation || remediation?.title || 'Remediate the observed weakness.')}</p>
      <p><strong>Owner</strong><br>${escapeHtml(remediation?.owner_email || 'Unassigned')}</p>
      <p><strong>Exact retest</strong><br>${escapeHtml(exactRetest(finding))}</p>
      <div class="notice"><strong>Verification rule</strong><br>This remediation remains open until bounded retest evidence supports closure. Assignment or implementation alone is not verification.</div>
    </div>
  </details>`;
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
    const findings = (inspection?.findings || []).filter((item) => item?.review?.status !== 'false-positive');
    if (!findings.length) return;
    const remediations = (project?.remediations || []).filter((item) => item?.assessment_id === assessmentId);
    const pairs = findings.map((finding) => {
      const key = remediationFindingKey(assessmentId, {
        id: finding?.ruleId || finding?.title || 'observed-finding',
        title: finding?.title || finding?.ruleId || 'Observed finding',
      });
      return { finding, remediation: remediations.find((item) => item.finding_key === key) };
    }).filter((item) => item.remediation);
    if (!pairs.length) return;

    const signature = `${latest.id}:${pairs.map((item) => item.remediation.id).join(',')}`;
    if (list.dataset.observedRemediationCards === signature) return;
    list.dataset.observedRemediationCards = signature;

    const heading = list.querySelector('.section-heading');
    if (!heading) return;
    [...list.children].forEach((child) => { if (child !== heading) child.remove(); });
    const container = document.createElement('div');
    container.className = 'remediation-list observed-remediation-list';
    container.innerHTML = pairs.map(({ finding, remediation }) => observedCard(finding, remediation)).join('');
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
