import { api, escapeHtml } from './shared.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('id') || '';
const token = params.get('token') || '';
let rendered = false;

function statusText(status) {
  return ({
    open: 'Fix not yet verified',
    evidence_attached: 'Implementation evidence linked',
    ready_for_retest: 'Ready for exact retest',
    retested: 'Retest recorded',
    verified_closed: 'Verified closed',
    accepted_risk: 'Risk accepted',
    evidence_upgrade_required: 'Evidence upgrade required',
  })[status] || String(status || 'Open').replaceAll('_', ' ');
}

async function linkedRemediations() {
  try {
    const overview = await api('/api/control-plane/overview');
    const candidates = [...(overview.projects || []), ...(overview.assessmentCases?.projects || [])]
      .filter((item, index, all) => item?.id && all.findIndex((candidate) => candidate.id === item.id) === index);
    for (const candidate of candidates) {
      try {
        const project = (await api(`/api/projects/${encodeURIComponent(candidate.id)}`)).project;
        const items = (project?.remediations || []).filter((item) => item.assessment_id === assessmentId);
        if (items.length) return { project, items };
      } catch {}
    }
  } catch {}
  return { project: null, items: [] };
}

async function inspections() {
  try {
    return (await api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`)).inspections || [];
  } catch {
    return [];
  }
}

function inspectionSummary(items) {
  if (!items.length) return '<p>No observed Inspector evidence is linked yet.</p>';
  const latest = items[0];
  const previous = items[1];
  const posture = latest.postureScore ?? latest.posture ?? latest.score;
  const findingCount = latest.findingCount ?? latest.findingsCount ?? latest.findings?.length;
  const comparison = previous && posture != null
    ? ` Previous scan ${previous.postureScore ?? previous.posture ?? previous.score ?? '—'}/100.`
    : '';
  return `<p><strong>Latest observed scan:</strong> ${escapeHtml(posture ?? 'recorded')}${posture != null ? '/100' : ''}${findingCount != null ? ` · ${escapeHtml(findingCount)} finding${Number(findingCount) === 1 ? '' : 's'}` : ''}.${escapeHtml(comparison)}</p><p class="microcopy">Observed static evidence can support or challenge a claim, but it does not automatically close a declared runtime or governance finding.</p>`;
}

function remediationSummary(items, project) {
  if (!items.length) return '<p>No remediation record is linked to this assessment yet.</p>';
  const verified = items.filter((item) => item.status === 'verified_closed').length;
  const withEvidence = items.filter((item) => ['evidence_attached', 'ready_for_retest', 'retested', 'verified_closed'].includes(item.status)).length;
  const retested = items.filter((item) => ['retested', 'verified_closed'].includes(item.status)).length;
  const rows = items.map((item) => `<li><strong>${escapeHtml(String(item.finding_key || '').split(':').at(-1) || 'Finding')}</strong><span>${escapeHtml(statusText(item.status))}</span></li>`).join('');
  return `<div class="remediation-milestones"><div><strong>${items.length}</strong><span>tracked</span></div><div><strong>${withEvidence}</strong><span>with evidence</span></div><div><strong>${retested}</strong><span>retested</span></div><div><strong>${verified}</strong><span>verified closed</span></div></div><ul class="plain-list">${rows}</ul>${project ? `<a class="button primary small" href="/control-plane.html?assessment=${encodeURIComponent(assessmentId)}#remediation">Continue fix and retest</a>` : ''}`;
}

async function renderCurrentState() {
  if (!assessmentId || rendered) return;
  const decision = document.querySelector('.result-decision-card');
  if (!decision) return;
  rendered = true;
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  let assessment;
  try {
    assessment = (await api(`/api/assessments/${encodeURIComponent(assessmentId)}${query}`)).assessment;
  } catch {
    return;
  }
  const [{ project, items }, scanItems] = await Promise.all([linkedRemediations(), inspections()]);
  const paid = assessment?.paidTier !== 'free';
  const section = document.createElement('section');
  section.className = 'workspace-section current-proof-state';
  section.id = 'currentProofState';
  section.innerHTML = `<div class="workspace-section-heading"><div><span class="eyebrow">Current proof state</span><h2>What changed after this assessment?</h2><p>The assessment above remains the historical baseline. New evidence, fixes and retests are shown separately so declarations are never rewritten into proof.</p></div></div><div class="panel"><h3>Observed evidence</h3>${inspectionSummary(scanItems)}</div><div class="panel section-gap"><h3>Finding → fix → retest → closure</h3>${remediationSummary(items, project)}${!paid ? '<div class="notice"><strong>Paid outcome</strong><span>The £99 Security Assessment unlocks the remediation, evidence, exact-retest and accountable closure workflow. Existing assessment and observed evidence remain preserved through checkout.</span></div>' : ''}</div>`;
  decision.insertAdjacentElement('afterend', section);

  const localNav = document.querySelector('.workspace-local-nav');
  if (localNav && !localNav.querySelector('a[href="#currentProofState"]')) {
    const link = document.createElement('a');
    link.href = '#currentProofState';
    link.textContent = 'Current proof';
    localNav.appendChild(link);
  }
}

const observer = new MutationObserver(() => void renderCurrentState());
observer.observe(document.querySelector('#resultRoot') || document.body, { childList: true, subtree: true });
void renderCurrentState();
