import { api, setBusy, showError } from './shared.js';
import { matchingAssessmentProject } from './assessment-remediation.js';

const root = document.querySelector('#dashboardRoot');
let dashboard = null;
let groups = [];
let decorating = false;

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function groupAssessments(assessments = []) {
  const grouped = new Map();
  for (const assessment of assessments) {
    const key = `${normalise(assessment.name)}::${normalise(assessment.agent_type)}`;
    if (!grouped.has(key)) grouped.set(key, { name: assessment.name, agentType: assessment.agent_type, assessments: [] });
    grouped.get(key).assessments.push(assessment);
  }
  return [...grouped.values()];
}

function matchingProject(assessment) {
  if (!assessment || !dashboard) return null;
  return matchingAssessmentProject(dashboard.controlPlane || {}, {
    name: assessment.name,
    agentType: assessment.agent_type,
  });
}

function allAgentsRows() {
  const section = [...document.querySelectorAll('.workspace-section')].find((item) =>
    item.querySelector('.workspace-section-heading p')?.textContent?.includes('Each row shows the latest assessment only.'));
  return section ? [...section.querySelectorAll(':scope > .workspace-agent-list > .workspace-agent-row')] : [];
}

function workspaceError(message) {
  let box = document.querySelector('#workspaceAgentActionError');
  if (!box) {
    box = document.createElement('div');
    box.id = 'workspaceAgentActionError';
    box.className = 'error-box';
    root?.prepend(box);
  }
  if (box) showError(box, message);
}

function workspaceSuccess(message) {
  if (!root) return;
  const box = document.createElement('div');
  box.className = 'success-box';
  box.textContent = message;
  root.prepend(box);
}

function selectedAssessmentId() {
  return new URLSearchParams(location.search).get('assessment') || sessionStorage.getItem('arl_selected_assessment') || '';
}

async function deleteLatestAssessment(event) {
  const button = event.currentTarget;
  const index = Number(button.dataset.assessmentIndex);
  const group = groups[index];
  const latest = group?.assessments?.[0];
  if (!latest) return workspaceError('Reload the workspace before deleting this assessment.');

  const checkedAt = new Date(latest.created_at).toLocaleDateString('en-GB');
  const confirmed = window.confirm(`Delete the ${group.name} assessment from ${checkedAt}?\n\nThis permanently deletes this assessment and evidence attached specifically to it. It does not delete the agent project, other assessments, runtime history or billing records.`);
  if (!confirmed) return;

  setBusy(button, true, 'Deleting…');
  try {
    await api(`/api/assessments/${encodeURIComponent(latest.id)}`, { method: 'DELETE' });
    const wasSelected = selectedAssessmentId() === latest.id;
    const fallback = group.assessments[1] || null;
    if (wasSelected) {
      sessionStorage.removeItem('arl_selected_assessment');
      if (fallback?.id) {
        sessionStorage.setItem('arl_selected_assessment', fallback.id);
        location.href = `/dashboard.html?assessment=${encodeURIComponent(fallback.id)}`;
        return;
      }
    }
    location.href = '/dashboard.html';
  } catch (error) {
    workspaceError(error.message);
    setBusy(button, false);
  }
}

async function deleteAgent(event) {
  const button = event.currentTarget;
  const index = Number(button.dataset.agentIndex);
  const group = groups[index];
  if (!group) return workspaceError('Reload the workspace before deleting this agent.');
  const latest = group.assessments[0];
  const project = matchingProject(latest);
  if (!project?.id) return workspaceError('This agent has no exact linked project, so project-wide deletion is not available from this view.');
  const name = group.name;
  const historyCount = group.assessments.length;
  const scope = `This permanently deletes ${historyCount} assessment record${historyCount === 1 ? '' : 's'} for this agent and the linked project, including its connection keys, runtime decisions, inventory, remediation and Control Intelligence evidence. Payment and billing records are retained for accounting but are detached from the deleted agent.`;
  const confirmation = window.prompt(`${scope}\n\nThis cannot be undone. Type the exact agent name to confirm:\n${name}`);
  if (confirmation == null) return;
  if (confirmation !== name) return workspaceError('Agent name did not match. Nothing was deleted.');

  setBusy(button, true, 'Deleting…');
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ deleteAgent: true, assessmentId: latest.id, confirmation }),
    });
    sessionStorage.removeItem('arl_selected_project');
    sessionStorage.removeItem('arl_selected_assessment');
    sessionStorage.setItem('arl_agent_deleted_notice', `${name} was permanently deleted from this workspace.`);
    location.href = '/dashboard.html';
  } catch (error) {
    workspaceError(error.message);
    setBusy(button, false);
  }
}

function decorateRows() {
  if (!dashboard || decorating) return;
  const rows = allAgentsRows();
  if (!rows.length || rows.length !== groups.length) return;
  decorating = true;
  rows.forEach((row, index) => {
    const actions = row.querySelector('.workspace-agent-row-actions');
    if (!actions) return;
    const group = groups[index];
    const latest = group.assessments[0];

    if (!actions.querySelector('[data-delete-latest-assessment]')) {
      const assessmentButton = document.createElement('button');
      assessmentButton.type = 'button';
      assessmentButton.className = 'button ghost small';
      assessmentButton.textContent = 'Delete assessment';
      assessmentButton.dataset.deleteLatestAssessment = 'true';
      assessmentButton.dataset.assessmentIndex = String(index);
      assessmentButton.setAttribute('aria-label', `Delete latest ${group.name} assessment only`);
      assessmentButton.addEventListener('click', deleteLatestAssessment);
      actions.append(assessmentButton);
    }

    if (actions.querySelector('[data-delete-agent]')) return;
    const project = matchingProject(latest);
    if (!project?.id) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button danger small';
    button.textContent = 'Delete agent';
    button.dataset.deleteAgent = 'true';
    button.dataset.agentIndex = String(index);
    button.setAttribute('aria-label', `Delete ${group.name} and its linked evidence`);
    button.addEventListener('click', deleteAgent);
    actions.append(button);
  });
  decorating = false;
}

async function initialise() {
  const notice = sessionStorage.getItem('arl_agent_deleted_notice');
  if (notice) {
    sessionStorage.removeItem('arl_agent_deleted_notice');
    const renderNotice = () => {
      if (!root || root.classList.contains('loading')) return false;
      workspaceSuccess(notice);
      return true;
    };
    if (!renderNotice()) setTimeout(renderNotice, 250);
  }
  try {
    dashboard = await api('/api/dashboard');
    groups = groupAssessments(dashboard.assessments || []);
    decorateRows();
    if (root) new MutationObserver(decorateRows).observe(root, { childList: true, subtree: true });
  } catch {
    // The primary dashboard remains usable if these secondary destructive actions cannot load.
  }
}

initialise();
