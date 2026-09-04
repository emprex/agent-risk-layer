import { api } from './shared.js';

let activeRequest = '';
let appliedKey = '';

function currentAssessmentTarget() {
  const root = document.querySelector('#dashboardRoot');
  const command = root?.querySelector('.workspace-agent-command');
  if (!command) return null;

  const noLinkedProject = [...root.querySelectorAll('p')].some((node) =>
    /No exact-name evidence project is linked from this dashboard view/i.test(node.textContent || '')
  );
  if (!noLinkedProject) return null;

  const resultLink = [...command.querySelectorAll('a[href*="/result.html?id="]')][0];
  if (!resultLink) return null;
  const url = new URL(resultLink.href, location.origin);
  const id = url.searchParams.get('id') || '';
  const token = url.searchParams.get('token') || '';
  if (!id) return null;
  return { root, id, token };
}

function decisionLabel(value = '') {
  const normalised = String(value || '').trim().toLowerCase();
  if (normalised === 'hold') return 'Hold';
  if (normalised === 'proceed') return 'Proceed';
  if (normalised === 'do_not_deploy') return 'Do not deploy';
  return '';
}

function decisionState(value = '') {
  const normalised = String(value || '').trim().toLowerCase();
  if (normalised === 'proceed') return 'proceed';
  if (normalised === 'do_not_deploy') return 'stop';
  return 'hold';
}

function applyAssessmentDecision(target, assessment) {
  const decision = assessment?.result?.deploymentDecision;
  const label = decisionLabel(decision?.decision);
  if (!label) return false;

  const root = target.root;
  const deploymentCard = root.querySelector('#deploymentEvidenceState');
  if (deploymentCard) {
    deploymentCard.dataset.state = decisionState(decision.decision);
    const title = deploymentCard.querySelector('strong');
    const detail = deploymentCard.querySelector('p');
    if (title) title.textContent = `Assessment decision: ${label}`;
    if (detail) detail.textContent = 'Human deployment decision recorded for this assessed revision. No linked evidence project is required to display this assessment decision.';
  }

  const statusCards = [...root.querySelectorAll('.workspace-status-grid .workspace-status-card')];
  const assessmentCard = statusCards.find((card) => card !== deploymentCard && /Latest assessment/i.test(card.querySelector('small')?.textContent || ''));
  if (assessmentCard) {
    assessmentCard.dataset.state = decisionState(decision.decision);
    const title = assessmentCard.querySelector('strong');
    const detail = assessmentCard.querySelector('p');
    if (title) title.textContent = `Assessment complete · ${label}`;
    if (detail) detail.textContent = 'The declared score remains available as context, but it is not the deployment decision.';
  }

  const next = root.querySelector('#dashboardNextAction');
  if (next) {
    const title = next.querySelector('strong');
    const detail = next.querySelector('p');
    const link = next.querySelector('a');
    if (title) title.textContent = label === 'Hold'
      ? 'Close remaining evidence gaps before reassessment'
      : 'Review the recorded deployment decision';
    if (detail) detail.textContent = label === 'Hold'
      ? 'Hold is recorded for this frozen revision. Do not create remediation work unless evidence confirms a finding.'
      : `${label} is recorded for this assessed revision. Review the evidence chain before changing the decision.`;
    if (link) {
      link.href = `/result.html?id=${encodeURIComponent(target.id)}${target.token ? `&token=${encodeURIComponent(target.token)}` : ''}#deploymentReview`;
      link.textContent = 'Review decision';
    }
  }

  const currentRow = [...root.querySelectorAll('.workspace-agent-row')].find((row) => /· Current/i.test(row.querySelector('h3')?.textContent || ''));
  const rowCopy = currentRow?.querySelector('p');
  if (rowCopy) {
    const parts = rowCopy.textContent.split(' · ');
    if (parts.length >= 2) rowCopy.textContent = `${parts[0]} · Assessment complete · ${label} · ${parts.at(-1)}`;
  }

  root.dataset.assessmentDecisionShown = 'true';
  return true;
}

async function hydrateAssessmentDecision() {
  const target = currentAssessmentTarget();
  if (!target) return;
  const key = `${target.id}:${target.token}`;
  if (appliedKey === key || activeRequest === key) return;
  activeRequest = key;
  try {
    const query = target.token ? `?token=${encodeURIComponent(target.token)}` : '';
    const payload = await api(`/api/assessments/${encodeURIComponent(target.id)}${query}`);
    if (currentAssessmentTarget()?.id !== target.id) return;
    if (applyAssessmentDecision(target, payload.assessment)) appliedKey = key;
  } catch {
    // The base dashboard remains usable if assessment detail cannot be hydrated.
  } finally {
    if (activeRequest === key) activeRequest = '';
  }
}

const observer = new MutationObserver(() => { hydrateAssessmentDecision(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
hydrateAssessmentDecision();
