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

async function deleteAgent(event) {
  const button = event.currentTarget;
  const index = Number(button.dataset.agentIndex);
  const group = groups[index];
  if (!group) return workspaceError('Reload the workspace before deleting this agent.');
  const latest = group.assessments[0];
  const project = matchingProject(latest);
  const name = group.name;
  const historyCount = group.assessments.length;
  const scope = project
    ? `This permanently deletes ${historyCount} assessment record${historyCount === 1 ? '' : 's'} for this agent and the linked project, including its connection keys, runtime decisions, inventory, remediation and Control Intelligence evidence. Payment and billing records are retained for accounting but are detached from the deleted agent.`
    : `This permanently deletes ${historyCount} assessment record${historyCount === 1 ? '' : 's'} for this agent and their attached assessment evidence. Payment and billing records are retained for accounting but are detached from the deleted assessment.`;
  const confirmation = window.prompt(`${scope}\n\nThis cannot be undone. Type the exact agent name to confirm:\n${name}`);
  if (confirmation == null) return;
  if (confirmation !== name) return workspaceError('Agent name did not match. Nothing was deleted.');

  setBusy(button, true, 'Deleting…');
  try {
    if (project?.id) {
      await api(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deleteAgent: true, assessmentId: latest.id, confirmation }),
      });
    } else {
      for (const assessment of group.assessments) {
        await api(`/api/assessments/${encodeURIComponent(assessment.id)}`, { method: 'DELETE' });
      }
    }
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
    if (!actions || actions.querySelector('[data-delete-agent]')) return;
    const group = groups[index];
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
    // The primary dashboard remains usable if this secondary destructive action cannot load.
  }
}

initialise();
