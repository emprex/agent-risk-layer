import { api, escapeHtml, setBusy, showError } from './shared.js';
import {
  assessmentEnvironment,
  assessmentProjects,
  linkedAssessmentRemediations,
  matchingAssessmentProject,
  remediationFindingKey,
} from './assessment-remediation.js';
import { assessmentFixControl } from './assessment-fix-controls.js';

const root = document.querySelector('#controlPlaneRoot');
const errorBox = document.querySelector('#controlPlaneError');
let overview = null;
let project = null;
let selectedProjectId = sessionStorage.getItem('arl_selected_project') || '';
let revealedKey = '';
let revealedApproval = null;
let refreshTimer = null;
let technicalMode = sessionStorage.getItem('arl_control_plane_mode') === 'technical';
let guidedCheck = null;
const handoffParams = new URLSearchParams(location.search);
const assessmentId = handoffParams.get('assessment') || '';
const assessmentToken = handoffParams.get('token') || '';
let assessmentContext = null;
let assessmentProjectConfirmed = false;
const assessmentControlProgress = new Map();
const runtimeProjects = () => (overview?.projects || []).filter((item) => item.projectKind !== 'assessment_case');

const severityOrder = { critical: 1, high: 2, medium: 3, low: 4, none: 5 };

document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  location.href = '/';
});

init();

async function init() {
  if (assessmentId || ['#runtime', '#policy', '#inventory', '#remediation', '#audit'].includes(location.hash)) technicalMode = true;
  try {
    await loadOverview();
    if (assessmentId) {
      const tokenQuery = assessmentToken ? `?token=${encodeURIComponent(assessmentToken)}` : '';
      const payload = await api(`/api/assessments/${encodeURIComponent(assessmentId)}${tokenQuery}`);
      assessmentContext = payload.assessment;
      const candidates = assessmentProjects(overview);
      for (const candidate of candidates) {
        const candidateProject = (await api(`/api/projects/${encodeURIComponent(candidate.id)}`)).project;
        if (linkedAssessmentRemediations(candidateProject, assessmentId).length) {
          project = candidateProject;
          selectedProjectId = candidate.id;
          assessmentProjectConfirmed = true;
          break;
        }
      }
      await loadAssessmentControlProgress();
    } else {
      const availableRuntimeProjects = runtimeProjects();
      if (selectedProjectId && availableRuntimeProjects.some((item) => item.id === selectedProjectId)) await loadProject(selectedProjectId);
      else if (availableRuntimeProjects[0]) await loadProject(availableRuntimeProjects[0].id);
    }
    render();
    startRefresh();
  } catch (error) {
    if (/sign in/i.test(error.message)) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      location.href = `/auth.html?next=${encodeURIComponent(next)}`;
    } else fail(error);
  }
}

async function loadAssessmentControlProgress() {
  assessmentControlProgress.clear();
  if (!project || !assessmentId) return;
  const linked = linkedAssessmentRemediations(project, assessmentId);
  await Promise.all(linked.map(async (item) => {
    const findingId = item.finding_key?.split(':').at(-1);
    const controlId = assessmentFixControl(findingId)?.controlId;
    if (!controlId) return;
    try {
      const detail = await api(`/api/projects/${encodeURIComponent(project.id)}/control-intelligence/controls/${encodeURIComponent(controlId)}`);
      const tests = [...(detail.tests || []), ...(detail.testHistory || [])].filter((test, index, all) => test?.id && all.findIndex((candidate) => candidate.id === test.id) === index);
      const latest = tests.sort((left, right) => String(right.completedAt || right.startedAt || '').localeCompare(String(left.completedAt || left.startedAt || '')))[0] || null;
      const started = detail.applicability?.status === 'applicable' || tests.length > 0;
      assessmentControlProgress.set(findingId, {
        controlId,
        started,
        latestResult: latest?.result || '',
        latestAt: latest?.completedAt || latest?.startedAt || '',
        nextAction: detail.chain?.nextAction || '',
      });
    } catch {
      // Progress is helpful context, never a reason to block the remediation plan.
    }
  }));
}

async function loadOverview() {
  overview = await api('/api/control-plane/overview');
}

async function loadProject(projectId) {
  project = (await api(`/api/projects/${encodeURIComponent(projectId)}`)).project;
  selectedProjectId = projectId;
  sessionStorage.setItem('arl_selected_project', projectId);
}

function assessmentFindings() {
  return (assessmentContext?.result?.findings || []).filter((item) =>
    item.status !== 'information-required' && item.kind !== 'information-required');
}

function assessmentReturnHref() {
  const params = new URLSearchParams({ id: assessmentId });
  if (assessmentToken) params.set('token', assessmentToken);
  return `/result.html?${params.toString()}`;
}

function assessmentHandoffPanel() {
  const candidates = assessmentProjects(overview);
  const suggested = matchingAssessmentProject(overview, assessmentContext);
  const canCreateCase = Boolean(overview.assessmentCases?.canCreate);
  const canCreateRuntime = runtimeProjects().length < Number(overview.entitlement?.projects || 0);
  const first = assessmentFindings()[0];
  return `<section class="panel assessment-handoff">
    <span class="eyebrow">Assessment → remediation</span>
    <h2>Choose where to track ${escapeHtml(assessmentContext.name)} fixes</h2>
    <p>This assessment is not linked to a remediation project yet. Nothing will be added to another agent unless you explicitly choose it.</p>
    ${first ? `<div class="assessment-handoff-finding"><small>First declared weakness</small><strong>${escapeHtml(first.title)}</strong><span>${escapeHtml(first.recommendation)}</span></div>` : ''}
    ${candidates.length ? `<form id="assessmentProjectForm" class="auth-form"><div class="field"><label for="assessmentProjectSelect">Existing project or assessment case</label><select id="assessmentProjectSelect" required><option value="">Choose the matching agent</option>${candidates.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === suggested?.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.projectKind === 'assessment_case' ? 'evidence-only case' : item.environment || 'project')}${item.id === suggested?.id ? ' · possible name match' : ''}</option>`).join('')}</select><small>Only choose an existing project when it represents this exact Northstar deployment and version.</small></div><button class="button ghost" type="submit">Use selected project</button></form>` : ''}
    ${canCreateCase || canCreateRuntime ? `<div class="assessment-create-scope"><span>Recommended</span><p>Create a dedicated scope for this exact assessment so its fixes and evidence cannot mix with another agent.</p><button class="button primary" id="createAssessmentRemediationCase" type="button">Create dedicated remediation scope</button></div>` : '<div class="notice warning">Your current plan has no unused project slot. Choose a genuinely matching project above or change plan before tracking these fixes.</div>'}
    <a class="button ghost small" href="${assessmentReturnHref()}">Back to assessment result</a>
  </section>`;
}

function assessmentRemediationWorkspace() {
  const findings = assessmentFindings();
  const linked = linkedAssessmentRemediations(project, assessmentId);
  const linkedKeys = new Set(linked.map((item) => item.finding_key));
  const remaining = findings.filter((finding) => !linkedKeys.has(remediationFindingKey(assessmentId, finding)));
  const first = remaining[0];
  const owner = defaultRemediationOwner(linked);
  const progress = remediationProgress(linked);
  const ordered = [...linked].sort((left, right) => (severityOrder[left.severity] || 9) - (severityOrder[right.severity] || 9));
  const waiting = ordered.find((item) => assessmentControlProgress.get(item.finding_key?.split(':').at(-1))?.latestResult === 'inconclusive');
  const active = ordered
    .filter((item) => {
      const itemProgress = assessmentControlProgress.get(item.finding_key?.split(':').at(-1));
      return itemProgress?.started && itemProgress.latestResult !== 'inconclusive';
    })
    .sort((left, right) => {
      const leftAt = assessmentControlProgress.get(left.finding_key?.split(':').at(-1))?.latestAt || '';
      const rightAt = assessmentControlProgress.get(right.finding_key?.split(':').at(-1))?.latestAt || '';
      return rightAt.localeCompare(leftAt);
    });
  const next = active[0] || ordered.find((item) => item !== waiting && !assessmentControlProgress.get(item.finding_key?.split(':').at(-1))?.started) || waiting || ordered[0];
  const nextFindingId = next?.finding_key?.split(':').at(-1);
  const nextProgress = assessmentControlProgress.get(nextFindingId);
  const nextStatus = nextProgress?.latestResult === 'planned'
    ? 'Test planned — run it when the staging system is available.'
    : nextProgress?.started
      ? (nextProgress.nextAction || 'Continue the recorded control workflow.')
      : 'Work on the highest-priority available fix. Evidence and retesting come later.';
  const waitingFindingId = waiting?.finding_key?.split(':').at(-1);
  const waitingCard = waiting && waiting !== next
    ? `<div class="next-remediation waiting-remediation"><div><small>Waiting on developer</small><strong>${escapeHtml(waitingFindingId)} · ${escapeHtml(waiting.title)}</strong><span>Test inconclusive — connect the staging agent or hand the test pack to a developer.</span></div><button class="button ghost" type="button" data-open-remediation="${escapeHtml(waiting.id)}">View blocked fix</button></div>`
    : '';
  const remainingPreview = remaining.map((finding) => `<li><span class="status-pill">${escapeHtml(finding.severity)}</span><div><strong>${escapeHtml(finding.id)} · ${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.recommendation)}</small></div></li>`).join('');
  const planning = remaining.length ? `
    <section class="panel remediation-plan-card">
      <span class="eyebrow">Recommended</span>
      <h3>Create the complete remediation plan</h3>
      <p>Assign the remaining ${remaining.length} fixes once. You can edit every item later. This records responsibility only—it does not claim anything is implemented or verified.</p>
      <form id="bulkRemediationForm" class="auth-form">
        <div class="field"><label for="bulkRemediationOwner">Who will coordinate these fixes?</label><input id="bulkRemediationOwner" type="email" required autocomplete="email" value="${escapeHtml(owner)}" placeholder="Example: security@company.com"><small>Applied to all remaining fixes. Individual owners can be changed later.</small></div>
        <details class="plan-review"><summary>Review ${remaining.length} proposed fixes</summary><ol>${remainingPreview}</ol></details>
        <button class="button primary" type="submit">Assign ${remaining.length} remaining fix${remaining.length === 1 ? '' : 'es'}</button>
      </form>
      <details class="manual-remediation"><summary>Adjust and track one fix instead</summary>
        <form id="remediationForm" class="auth-form">
          <div class="field"><label for="assessmentFinding">Declared weakness</label><select id="assessmentFinding">${remaining.map((finding) => `<option value="${escapeHtml(finding.id)}">${escapeHtml(finding.id)} · ${escapeHtml(finding.title)}</option>`).join('')}</select></div>
          <div class="field"><label for="remediationTitle">What must change?</label><input id="remediationTitle" required maxlength="240" value="${escapeHtml(first.recommendation)}"></div>
          <div class="form-grid"><div class="field"><label for="remediationSeverity">How serious is it?</label><select id="remediationSeverity">${['critical','high','medium','low'].map((severity) => `<option ${severity === first.severity ? 'selected' : ''}>${severity}</option>`).join('')}</select></div><div class="field"><label for="remediationOwner">Who owns the fix?</label><input id="remediationOwner" type="email" required autocomplete="email" value="${escapeHtml(owner)}" placeholder="Example: security@company.com" aria-describedby="remediationOwnerHelp"><small id="remediationOwnerHelp">Required — enter the email of the person accountable for completing this fix.</small></div></div>
          <p class="microcopy"><strong>Proof expected:</strong> ${escapeHtml(first.verification)}</p>
          <button class="button ghost" type="submit">Track this fix only</button>
        </form>
      </details>
    </section>` : `
    <section class="panel remediation-complete-card">
      <span class="eyebrow">Remediation plan created</span>
      <h3>Every declared weakness has an owner.</h3>
      <p>The plan is ready. Assignment is not proof of implementation, so the assessment remains unchanged until evidence is attached and retests pass.</p>
      <div class="remediation-milestones">
        <div><strong>${linked.length}</strong><span>assigned</span></div>
        <div><strong>${progress.implemented}</strong><span>with evidence</span></div>
        <div><strong>${progress.retested}</strong><span>retested</span></div>
        <div><strong>${progress.verified}</strong><span>verified closed</span></div>
      </div>
      ${waitingCard}
      ${next ? `<div class="next-remediation"><div><small>${nextProgress?.started ? 'Continue working' : 'Start here'}</small><strong>${escapeHtml(nextFindingId)} · ${escapeHtml(next.title)}</strong><span>${escapeHtml(nextStatus)}</span></div><button class="button primary" type="button" data-open-remediation="${escapeHtml(next.id)}">${nextProgress?.started ? 'Continue this fix' : 'Start this fix'}</button></div>` : ''}
    </section>`;
  return `<section class="assessment-remediation-workspace">
    <section class="panel assessment-scope-banner">
      <div><span class="eyebrow">Correct remediation scope</span><h2>${escapeHtml(assessmentContext.name)}</h2><p>${escapeHtml(assessmentContext.agentType || 'AI agent')} · assessment ${escapeHtml(assessmentId)}</p></div>
      <div><strong>${linked.length} of ${findings.length}</strong><span>fixes assigned</span><small>${remaining.length} remaining</small></div>
      <a class="button ghost small" href="${assessmentReturnHref()}">Return to result</a>
    </section>
    <section id="remediation" class="control-section assessment-only-remediation">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Fix and check again</span><h2>A clear plan, then one fix at a time.</h2><p>Each fix is bound to this assessment and the selected ${escapeHtml(project.name)} scope.</p></div><span class="status-pill">${linked.filter((item) => !['verified_closed', 'accepted_risk'].includes(item.status)).length} open</span></div>
      ${planning}
      <section class="panel remediation-plan-list">
        <div class="section-heading compact-heading"><div><h3>Your remediation plan</h3><p>Open a fix only when you are ready to work on it.</p></div><strong>${linked.length}</strong></div>
        ${linked.length ? assessmentWorkPackageList(linked) : '<p class="muted">No fixes assigned yet. Create the plan above when you are ready.</p>'}
      </section>
    </section>
  </section>`;
}

function defaultRemediationOwner(items) {
  const counts = new Map();
  for (const item of items) if (item.owner_email) counts.set(item.owner_email, (counts.get(item.owner_email) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
}

function remediationProgress(items) {
  return {
    implemented: items.filter((item) => ['evidence_attached', 'ready_for_retest', 'retested', 'verified_closed'].includes(item.status)).length,
    retested: items.filter((item) => ['retested', 'verified_closed'].includes(item.status)).length,
    verified: items.filter((item) => item.status === 'verified_closed').length,
  };
}

const assessmentWorkPackages = Object.freeze([
  {
    id: 'observe-contain',
    title: 'Observe and contain',
    outcome: 'Reconstruct important actions, detect unsafe behaviour, block releases after known failures and recover safely.',
    findings: ['F-01', 'F-02', 'F-03', 'F-04', 'F-05'],
  },
  {
    id: 'control-authority',
    title: 'Control authority',
    outcome: 'Limit who and what the agent can access, protect credentials and require exact external authorisation and approval.',
    findings: ['F-06', 'F-07', 'F-08', 'F-09'],
  },
  {
    id: 'protect-data-actions',
    title: 'Protect data and actions',
    outcome: 'Keep untrusted content, outputs, memory, sensitive data and network activity within independently enforced boundaries.',
    findings: ['F-10', 'F-11', 'F-12', 'F-13', 'F-14'],
  },
  {
    id: 'control-deployment',
    title: 'Control the deployment',
    outcome: 'Govern dependencies, enforce hard resource limits and assign one accountable owner for this deployment.',
    findings: ['F-15', 'F-16', 'F-17'],
  },
]);

function assessmentWorkPackageList(items) {
  return `<div class="remediation-work-packages">${assessmentWorkPackages.map((workPackage, index) => assessmentWorkPackage(workPackage, index, items)).join('')}</div>`;
}

function assessmentWorkPackage(workPackage, index, items) {
  const packageItems = workPackage.findings
    .map((findingId) => items.find((item) => item.finding_key?.split(':').at(-1) === findingId))
    .filter(Boolean);
  if (!packageItems.length) return '';
  const verified = packageItems.filter((item) => item.status === 'verified_closed').length;
  const withEvidence = packageItems.filter((item) => ['evidence_attached', 'ready_for_retest', 'retested', 'verified_closed'].includes(item.status)).length;
  const waiting = packageItems.filter((item) => assessmentControlProgress.get(item.finding_key?.split(':').at(-1))?.latestResult === 'inconclusive').length;
  const orderedPackageItems = [...packageItems].sort((left, right) => (severityOrder[left.severity] || 9) - (severityOrder[right.severity] || 9));
  const active = orderedPackageItems
    .filter((item) => {
      const controlProgress = assessmentControlProgress.get(item.finding_key?.split(':').at(-1));
      return controlProgress?.started && controlProgress.latestResult !== 'inconclusive' && item.status !== 'verified_closed';
    })
    .sort((left, right) => String(assessmentControlProgress.get(right.finding_key?.split(':').at(-1))?.latestAt || '').localeCompare(String(assessmentControlProgress.get(left.finding_key?.split(':').at(-1))?.latestAt || '')));
  const current = active[0]
    || orderedPackageItems.find((item) => item.status !== 'verified_closed' && assessmentControlProgress.get(item.finding_key?.split(':').at(-1))?.latestResult !== 'inconclusive');
  const blocked = orderedPackageItems.find((item) => item.status !== 'verified_closed');
  const packageAction = current || blocked;
  const currentFinding = packageAction?.finding_key?.split(':').at(-1);
  const status = verified === packageItems.length ? 'Verified' : current ? 'Continue package' : blocked ? 'View blocked package' : 'Ready';
  return `<section class="panel remediation-package">
    <div class="section-heading compact-heading">
      <div><p class="eyebrow">Work package ${index + 1} of ${assessmentWorkPackages.length}</p><h3>${escapeHtml(workPackage.title)}</h3><p>${escapeHtml(workPackage.outcome)}</p></div>
      <strong>${verified} of ${packageItems.length} verified</strong>
    </div>
    <div class="assessment-stats compact-stats">
      <span><strong>${withEvidence}</strong> with evidence</span>
      <span><strong>${waiting}</strong> waiting</span>
      <span><strong>${packageItems.length - verified}</strong> remaining</span>
    </div>
    <div class="button-row">
      ${packageAction ? `<button class="button primary" type="button" data-open-remediation="${escapeHtml(packageAction.id)}">${escapeHtml(status)}${currentFinding ? ` · ${escapeHtml(currentFinding)}` : ''}</button>` : ''}
      <button class="button secondary" type="button" data-copy-package="${escapeHtml(workPackage.id)}">Copy package test pack</button>
    </div>
    <details class="remediation-group"><summary><span>Expert detail · ${packageItems.length} individual controls</span><strong>${packageItems.length}</strong></summary><div class="remediation-list">${packageItems.map(remediationRow).join('')}</div></details>
  </section>`;
}

function remediationGroup(title, items, open) {
  if (!items.length) return '';
  return `<details class="remediation-group" ${open ? 'open' : ''}><summary><span>${escapeHtml(title)}</span><strong>${items.length}</strong></summary><div class="remediation-list">${items.map(remediationRow).join('')}</div></details>`;
}

function render() {
  root.className = '';
  if (assessmentContext) {
    root.innerHTML = assessmentProjectConfirmed && project
      ? assessmentRemediationWorkspace()
      : assessmentHandoffPanel();
  } else {
    root.innerHTML = technicalMode
      ? `${overviewHeader()}<div class="control-plane-layout technical-mode">${projectRail()}<section class="control-plane-main">${project ? projectView() : emptyProject()}</section></div>`
      : `<div class="guided-control-layout">${project ? `${guidedProjectContext()}${projectView()}` : emptyProject()}</div>`;
  }
  bind();
}

function guidedProjectContext() {
  const projects = runtimeProjects();
  const canCreate = projects.length < overview.entitlement.projects;
  return `<section class="guided-project-context" aria-label="Current protected agent">
    <div class="guided-project-identity"><span class="project-icon">${escapeHtml(project.name.slice(0, 2).toUpperCase())}</span><div><small>Protected agent</small><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(plainEnvironment(project.environment))} · ${formatNumber(project.entitlement?.usage?.requests || 0)} checks this month</span></div></div>
    ${projects.length > 1 ? `<label class="guided-project-switcher">Change agent<select id="guidedProjectSelect">${projects.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === project.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>` : `<div class="guided-plan-summary"><strong>${escapeHtml(overview.entitlement.name)}</strong><span>${canCreate ? 'You can add another project.' : 'Your plan includes one active project.'}</span>${canCreate ? '<button class="text-button" data-open-technical="project">Add another agent</button>' : '<a href="/pricing.html">Need more projects?</a>'}</div>`}
  </section>`;
}

function overviewHeader() {
  const totals = overview.totals;
  return `<section class="control-overview" aria-label="Technical account totals">
    <article><span>Security projects</span><strong>${totals.projects}</strong><small>Scoped by workspace</small></article>
    <article><span>Runtime checks this month</span><strong>${formatNumber(totals.runtimeRequestsMonth)}</strong><small>${formatPercent(totals.deniedMonth, totals.runtimeRequestsMonth)} denied</small></article>
    <article><span>Threats blocked</span><strong>${formatNumber(totals.deniedMonth)}</strong><small>Policy-enforced decisions</small></article>
    <article><span>Open remediation</span><strong>${formatNumber(totals.openRemediations)}</strong><small>Owned, tracked and retestable</small></article>
  </section>`;
}

function projectRail() {
  const projects = runtimeProjects();
  const canCreate = projects.length < overview.entitlement.projects;
  const planMessage = canCreate
    ? `${overview.entitlement.name} includes ${overview.entitlement.projects} active project${overview.entitlement.projects === 1 ? '' : 's'}.`
    : `${overview.entitlement.name} includes ${overview.entitlement.projects} active project${overview.entitlement.projects === 1 ? '' : 's'}. You are already using ${overview.entitlement.projects === 1 ? 'it' : 'them'}.`;
  return `<aside class="project-rail customer-project-rail">
    <div class="rail-heading"><span class="eyebrow">Your protected agents</span><small>${projects.length || '0'} active</small></div>
    <div class="project-list">${projects.map(projectButton).join('') || '<p class="muted small-copy">Your first protected agent will appear here.</p>'}</div>
    ${canCreate && projects.length ? `<details class="rail-create-details"><summary>Add another agent</summary>${projectCreateForm()}</details>` : ''}
    <div class="entitlement-card plain-plan-card"><strong>${escapeHtml(overview.entitlement.name)}</strong><span>${escapeHtml(planMessage)}</span><span>${formatNumber(overview.entitlement.runtimeRequestsPerMonth)} protection checks each month</span>${canCreate ? '' : '<a href="/pricing.html">Need more projects? Compare plans →</a>'}</div>
  </aside>`;
}

function projectButton(item) {
  const active = item.id === selectedProjectId ? 'active' : '';
  return `<button class="project-button ${active}" data-project-id="${escapeHtml(item.id)}">
    <span class="project-icon">${escapeHtml(item.name.slice(0, 2).toUpperCase())}</span>
    <span><strong>${escapeHtml(item.name)}</strong><small>${plainEnvironment(item.environment)} · ${formatNumber(item.runtimeRequestsMonth)} checks</small></span>
    <i class="project-health ${item.deniedMonth ? 'warning' : ''}"></i>
  </button>`;
}

function projectCreateForm() {
  return `<form id="createProject" class="mini-form rail-form">
    <label for="projectName">What do you call this agent?</label>
    <input id="projectName" name="name" required minlength="2" maxlength="100" placeholder="Customer support agent">
    <label for="projectEnvironment">Where is it used?</label>
    <select id="projectEnvironment" name="environment"><option value="development">Still being built</option><option value="test">Test environment</option><option value="staging">Staging</option><option value="production">Live production</option></select>
    <button class="button primary small" type="submit">Create protected agent</button>
  </form>`;
}

function ownerAssessmentCasePanel() {
  if (!overview.assessmentCases?.canCreate) return '';
  const cases = overview.assessmentCases.projects || [];
  return `<section class="panel owner-assessment-cases">
    <div class="section-heading compact-heading"><div><span class="eyebrow">Owner-only assessment workspace</span><h2>Assessment cases</h2></div><strong>${cases.length}</strong></div>
    <p>Create isolated design-partner or customer evidence cases without consuming the Community live-protection project allowance. Assessment cases cannot issue runtime keys, runtime approvals or protection quota.</p>
    ${cases.length ? `<div class="plain-event-list">${cases.map((item) => `<div><span class="plain-decision allow">Case</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(plainEnvironment(item.environment))} · evidence-only</small></div><a class="button ghost small" href="/control-intelligence.html?projectId=${encodeURIComponent(item.id)}">Open Control Intelligence</a></div>`).join('')}</div>` : '<p class="muted">No owner assessment cases yet.</p>'}
    <form id="createAssessmentCase" class="mini-form rail-form">
      <label for="assessmentCaseName">Assessment case name</label>
      <input id="assessmentCaseName" name="name" required minlength="2" maxlength="100" placeholder="CLARA Security Assessment">
      <button class="button primary" type="submit">Create assessment case</button>
    </form>
  </section>`;
}

function emptyProject() {
  return `<section class="panel empty-state customer-empty-project">
    <span class="eyebrow">Start here</span>
    <h2>Protect one AI agent.</h2>
    <p>Give it a name and tell us whether it is still being built, being tested or already live. You can see protection work before connecting any code.</p>
    ${projectCreateForm()}
    ${ownerAssessmentCasePanel()}
  </section>`;
}

function projectView() {
  return `${guidedProjectHome()}${technicalMode ? technicalProjectView() : ''}`;
}

function guidedProjectHome() {
  const hasGuidedEvents = project.events.some((event) => event.event_type === 'guided_demo');
  const hasRealEvents = project.events.some((event) => event.event_type === 'guard');
  const hasActiveKey = project.apiKeys.some((key) => key.status === 'active');
  const canApprove = project.permissions.approveActions;
  const stage = !hasGuidedEvents ? 1 : !hasActiveKey ? 2 : !hasRealEvents ? 3 : 4;
  const next = stage === 1
    ? { title: 'Watch the protection make four decisions', text: 'Use fictional refund data to prove that missing approval, a changed amount and a reused approval are blocked. No terminal or real system is involved.', action: 'guided' }
    : stage === 2
      ? { title: 'Connect your own agent when a developer is ready', text: 'The safe example passed. A developer can now create one connection key and add a Guard check before the agent performs an action.', action: 'connect' }
      : stage === 3
        ? { title: 'Send the first protected request', text: 'The connection key exists. Use the integration example once, then return here to see the real decision.', action: 'connect' }
        : { title: 'Review decisions and close the next risk', text: 'Your agent is sending protected requests. Review what was allowed or blocked and assign any required fix.', action: 'review' };
  return `<div class="customer-control-home">
    ${guidedProgress(stage)}
    ${ownerAssessmentCasePanel()}
    <section class="panel human-next-card v10-next-card">
      <div class="human-next-copy"><span class="eyebrow">Do this next</span><h2>${escapeHtml(next.title)}</h2><p>${escapeHtml(next.text)}</p><span class="next-time">${stage === 1 ? 'About 30 seconds' : stage === 2 ? 'Developer task · about 10 minutes' : 'Review whenever your agent is active'}</span></div>
      <div class="human-next-action">${nextActionButton(next, canApprove)}</div>
    </section>

    ${guidedResultPanel()}

    <section class="v10-control-choices" aria-label="Other actions">
      <article><span>Understand</span><h3>Check the agent’s wider risk</h3><p>Review access, data, autonomy, approvals and recovery in plain English.</p><a class="button ghost full" href="/assessment.html">Check this agent</a></article>
      <article><span>Connect</span><h3>Open developer controls</h3><p>Create keys, publish policy rules and connect the real agent only when ready.</p><button class="button ghost full" data-open-technical="runtime">Open technical controls</button></article>
      <article><span>Review</span><h3>See recent decisions</h3><p>Understand what was allowed, blocked or waiting for evidence.</p><button class="button ghost full" data-open-technical="runtime">Review decision evidence</button></article>
    </section>

    ${plainRecentActivity()}

    <section class="human-technical-toggle v10-specialist-note">
      <div><strong>For developers, security teams and auditors</strong><span>Policies, keys, approvals, access inventory, remediation and audit records are preserved in the specialist view.</span></div>
      <button class="button ghost" id="toggleTechnicalMode">Open specialist view</button>
    </section>
  </div>`;
}

function guidedProgress(stage) {
  const labels = ['Try a safe example', 'Connect the agent', 'Send a protected request', 'Review and improve'];
  return `<section class="guided-progress-v10" aria-label="Live protection progress"><div><span class="eyebrow">Your live-protection journey</span><strong>Step ${stage} of 4</strong></div><ol>${labels.map((label, index) => `<li class="${index + 1 < stage ? 'complete' : index + 1 === stage ? 'current' : ''}"><span>${index + 1 < stage ? '✓' : index + 1}</span><b>${escapeHtml(label)}</b></li>`).join('')}</ol></section>`;
}

function nextActionButton(next, canApprove) {
  if (next.action === 'guided') return `<button class="button primary button-xl" id="nextGuidedCheck" ${canApprove ? '' : 'disabled'}>${canApprove ? 'Run the safe example' : 'Ask an owner or admin'}</button>`;
  if (next.action === 'connect') return '<button class="button primary button-xl" data-open-technical="runtime">Connect my agent</button>';
  return '<button class="button primary button-xl" data-open-technical="runtime">Review decisions</button>';
}

function guidedResultPanel() {
  if (!guidedCheck) return `<section class="panel guided-explainer"><div><span class="eyebrow">What the safe check does</span><h2>Four automatic checks. One button.</h2></div><ol><li><strong>No approval</strong><span>must be blocked</span></li><li><strong>Changed amount</strong><span>must be blocked</span></li><li><strong>Exact approved action</strong><span>may be allowed once</span></li><li><strong>Reused approval</strong><span>must be blocked</span></li></ol><p>No external tool is called. The order and money are fictional.</p></section>`;
  return `<section class="panel guided-result ${guidedCheck.passed ? 'passed' : 'failed'}" aria-live="polite">
    <div class="guided-result-heading"><div><span class="eyebrow">Safe protection check</span><h2>${guidedCheck.passed ? 'Protection behaved as expected.' : 'One or more protections did not behave as expected.'}</h2><p>${guidedCheck.passed ? 'The exact action was allowed once. Missing, changed and reused approvals were blocked.' : 'Do not rely on this control until the failed check is investigated.'}</p></div><strong>${guidedCheck.results.filter((item) => item.passed).length}/${guidedCheck.results.length}</strong></div>
    <div class="guided-result-list">${guidedCheck.results.map((item) => `<div class="${item.passed ? 'passed' : 'failed'}"><span>${item.passed ? '✓' : '!'}</span><div><strong>${escapeHtml(item.label)}</strong><small>Expected ${escapeHtml(item.expectedDecision)} · received ${escapeHtml(item.decision)}${item.approvalStatus ? ` · approval ${escapeHtml(item.approvalStatus)}` : ''}</small></div></div>`).join('')}</div>
    <div class="guided-proof-note"><strong>What this proves</strong><span>${escapeHtml(guidedCheck.limitations[0])}</span><span>${escapeHtml(guidedCheck.limitations[1])}</span></div>
  </section>`;
}

function plainRecentActivity() {
  const events = project.events.slice(0, 5);
  return `<section class="panel plain-activity"><div class="section-heading compact-heading"><div><span class="eyebrow">Latest decisions</span><h2>What happened recently</h2></div>${events.length ? `<button class="button ghost small" data-open-technical="runtime">View technical evidence</button>` : ''}</div>${events.length ? `<div class="plain-event-list">${events.map((event) => `<div><span class="plain-decision ${event.decision}">${event.decision === 'deny' ? 'Blocked' : 'Allowed'}</span><div><strong>${escapeHtml(event.tool_name || 'Content check')}</strong><small>${plainEventReason(event)} · ${dateTime(event.created_at)}</small></div></div>`).join('')}</div>` : '<div class="empty-state"><p>No decisions yet. Run the safe protection check to see the first results.</p></div>'}</section>`;
}

function plainEventReason(event) {
  if (event.event_type === 'guided_demo') return 'Safe fictional test';
  if (event.ruleIds?.includes('ARL-RUN-009')) return 'Human approval was missing or invalid';
  if (event.ruleIds?.includes('ARL-RUN-011')) return 'Approval expired or was revoked';
  if (event.ruleIds?.includes('ARL-RUN-012')) return 'Approval had already been used';
  if (event.decision === 'deny') return 'Policy stopped the action';
  return 'Policy allowed the action';
}

function technicalProjectView() {
  const usage = project.entitlement.usage;
  const latestInventory = project.inventory[0] || null;
  const openItems = project.remediations.filter((item) => !['verified_closed', 'accepted_risk'].includes(item.status));
  return `<section id="technicalControls" class="technical-controls-wrap">
    ${journeyPanel()}
    <section class="panel project-command-header">
      <div><span class="eyebrow">${escapeHtml(project.environment)} · ${escapeHtml(project.role)}</span><h2>Technical controls</h2><p>${escapeHtml(project.slug)} · policy v${escapeHtml(project.policyVersion)} · ${project.retentionDays}-day event retention</p></div>
      <div class="command-status"><span>${project.policy.mode === 'enforce' ? 'Enforcing' : 'Monitoring'}</span><strong>${formatNumber(usage.requests)} / ${formatNumber(project.entitlement.runtimeRequestsPerMonth)}</strong><small>runtime checks this month</small></div>
    </section>
    <nav class="control-tabs" aria-label="Technical project sections"><a href="#runtime">Connect</a><a href="#policy">Rules</a><a href="#inventory">Access map</a><a href="#remediation">Fix and retest</a><a href="#audit">Audit</a></nav>
    <section id="runtime" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Connect your agent</span><h2>Screen every agent step.</h2></div><button id="createKeyButton" class="button primary small" ${project.permissions.rotateKeys ? '' : 'disabled'}>Create connection key</button></div>
      ${revealedKey ? oneTimeKey(revealedKey) : ''}
      ${revealedApproval ? oneTimeApproval(revealedApproval) : ''}
      <div class="runtime-grid">
        <article class="panel"><h3>Developer integration</h3><p class="muted">Place this Guard request before the agent reaches a model, tool or customer. This section is for the person connecting the software.</p><pre><code>${escapeHtml(curlExample())}</code></pre><button class="button ghost small" data-copy="curl">Copy developer example</button></article>
        <article class="panel"><h3>Connection keys</h3><div class="key-list">${project.apiKeys.length ? project.apiKeys.map(keyRow).join('') : '<p class="muted">No connection key yet. Create one only when a developer is ready to integrate the agent.</p>'}</div></article>
      </div>
      <div class="runtime-grid section-gap">
        <article class="panel"><h3>Approve one exact action</h3><p class="muted">For specialist testing or operations. The guided check above performs this automatically with fictional data.</p>${approvalForm()}</article>
        <article class="panel"><h3>Approval evidence</h3><div class="key-list">${project.approvals?.length ? project.approvals.map(approvalRow).join('') : '<p class="muted">No runtime approvals have been issued.</p>'}</div></article>
      </div>
      <article class="panel section-gap"><div class="section-heading compact-heading"><div><h3>Technical decision evidence</h3><p class="muted">Only digests, rule identifiers, bounded metadata and timing are retained.</p></div><span class="status-pill">${project.events.length} recent</span></div>${eventTable(project.events)}</article>
    </section>
    <section id="policy" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Rules</span><h2>Define what the agent may do.</h2></div></div>
      ${policyForm()}
    </section>
    <section id="inventory" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Access map</span><h2>Record what the agent can reach.</h2></div></div>
      <div class="runtime-grid"><article class="panel"><h3>Import a technical inventory</h3><p class="muted">A developer or security specialist can paste a deployment manifest. AgentRiskLayer stores the derived asset inventory, not credentials.</p><form id="inventoryForm" class="auth-form"><div class="field"><label for="inventorySource">Source label</label><input id="inventorySource" value="deployment-manifest" maxlength="40"></div><div class="field"><label for="inventoryJson">JSON manifest</label><textarea id="inventoryJson" rows="12" required placeholder='{"agent":{"name":"support-agent","model":"gpt-4.1","environment":"staging","tools":[{"kind":"tool","name":"crm.read"}]}}'></textarea></div><button class="button primary" type="submit">Analyse and compare</button></form></article><article class="panel"><h3>Latest access picture</h3>${latestInventory ? inventorySummary(latestInventory) : '<div class="empty-state"><p>No technical inventory has been imported.</p></div>'}</article></div>
      ${project.inventory.length ? `<article class="panel section-gap"><h3>Inventory history</h3>${inventoryHistory(project.inventory)}</article>` : ''}
    </section>
    <section id="remediation" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Fix and check again</span><h2>Own, fix and retest.</h2></div><span class="status-pill">${openItems.length} open</span></div>
      <div class="runtime-grid"><article class="panel"><h3>Add a required fix</h3><form id="remediationForm" class="auth-form"><div class="field"><label for="remediationTitle">What must change?</label><input id="remediationTitle" required maxlength="240" placeholder="Remove shell access from support agent"></div><div class="form-grid"><div class="field"><label for="remediationSeverity">How serious is it?</label><select id="remediationSeverity"><option>critical</option><option>high</option><option selected>medium</option><option>low</option></select></div><div class="field"><label for="remediationOwner">Who owns the fix?</label><input id="remediationOwner" type="email" placeholder="security@company.com"></div></div><button class="button primary" type="submit">Add required fix</button></form></article><article class="panel"><h3>Fixes and retests</h3><div class="remediation-list">${project.remediations.length ? project.remediations.map(remediationRow).join('') : '<p class="muted">No remediation work recorded.</p>'}</div></article></div>
    </section>
    <section id="audit" class="control-section"><div class="section-heading compact-heading"><div><span class="eyebrow">Audit evidence</span><h2>Who changed what and when.</h2></div></div><article class="panel">${auditTable(project.audit)}</article></section>
  </section>`;
}

function journeyPanel() {
  const journey = project.journey;
  return `<section class="panel journey-panel" id="project">
    <div class="section-heading compact-heading"><div><span class="eyebrow">Technical evidence journey</span><h2>${escapeHtml(journey.deploymentDecision)}</h2><p>${journey.nextAction ? `Next technical evidence step: ${escapeHtml(journey.nextAction.label)}` : 'Required evidence steps are complete. A human deployment review is still required.'}</p></div><strong>${journey.evidenceCollected}/${journey.steps.length}</strong></div>
    <div class="journey-steps">${journey.steps.map((step) => `<a class="${step.complete ? 'complete' : step.id === journey.nextAction?.id ? 'current' : ''}" href="${step.href}"><span>${step.complete ? '✓' : '○'}</span>${escapeHtml(step.label)}</a>`).join('')}</div>
    ${journey.blockingGaps.length ? `<div class="drift-banner warning"><strong>Evidence still needed</strong><span>${journey.blockingGaps.map(escapeHtml).join(' · ')}</span></div>` : ''}
  </section>`;
}

function policyForm() {
  const p = project.policy;
  return `<form id="policyForm" class="panel policy-editor">
    <div class="policy-mode"><label><input type="radio" name="mode" value="monitor" ${p.mode === 'monitor' ? 'checked' : ''}><span><strong>Monitor</strong><small>Return allow but report what policy would deny.</small></span></label><label><input type="radio" name="mode" value="enforce" ${p.mode === 'enforce' ? 'checked' : ''}><span><strong>Enforce</strong><small>Denied requests must not reach the model, tool or user.</small></span></label></div>
    <div class="form-grid policy-fields"><div class="field"><label for="allowedTools">Allowed tools</label><input id="allowedTools" value="${escapeHtml((p.allowedTools || []).join(', '))}" placeholder="crm.read, tickets.search"></div><div class="field"><label for="deniedTools">Denied tools</label><input id="deniedTools" value="${escapeHtml((p.deniedTools || []).join(', '))}" placeholder="shell, exec, delete"></div><div class="field"><label for="allowedHosts">Allowed network hosts</label><input id="allowedHosts" value="${escapeHtml((p.allowedHosts || []).join(', '))}" placeholder="api.company.com"></div><div class="field"><label for="approvalActions">Human approval required for</label><input id="approvalActions" value="${escapeHtml((p.requireApprovalFor || []).join(', '))}" placeholder="write, send, payment, deploy"></div></div>
    <div class="policy-switches"><label><input id="inspectInput" type="checkbox" ${p.inspectInput !== false ? 'checked' : ''}> Inspect prompts and external context</label><label><input id="inspectOutput" type="checkbox" ${p.inspectOutput !== false ? 'checked' : ''}> Inspect model output</label><label><input id="blockSecrets" type="checkbox" ${p.blockSecretLikeValues !== false ? 'checked' : ''}> Block secret-like tool arguments</label></div>
    <div class="button-row"><button class="button primary" type="submit" ${project.permissions.manage ? '' : 'disabled'}>Publish policy version</button><span class="muted small-copy">All changes are versioned in the project audit trail.</span></div>
  </form>`;
}

function oneTimeKey(value) {
  return `<div class="one-time-key"><div><strong>Copy this key now.</strong><span>It will never be shown again.</span></div><pre>${escapeHtml(value)}</pre><button class="button primary small" data-copy="key">Copy key</button></div>`;
}


function oneTimeApproval(approval) {
  return `<div class="one-time-key"><div><strong>Copy this approval token now.</strong><span>It authorises only ${escapeHtml(approval.tool)} with action digest ${escapeHtml(approval.actionDigest.slice(0, 16))}… and will never be shown again.</span></div><pre>${escapeHtml(approval.token)}</pre><button class="button primary small" data-copy="approval">Copy approval</button></div>`;
}

function approvalForm() {
  return `<form id="approvalForm" class="auth-form">
    <div class="field"><label for="approvalTool">Tool name</label><input id="approvalTool" required maxlength="200" value="refund_order" placeholder="refund_order"></div>
    <div class="field"><label for="approvalArguments">Exact JSON arguments</label><textarea id="approvalArguments" rows="7" required>{"orderId":"demo_order_4821","amountPence":17500,"currency":"GBP"}</textarea></div>
    <div class="field"><label for="approvalTtl">Validity</label><select id="approvalTtl"><option value="300">5 minutes</option><option value="600" selected>10 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option></select></div>
    <button class="button primary" type="submit" ${project.permissions.approveActions ? '' : 'disabled'}>${project.permissions.approveActions ? 'Issue exact-action approval' : 'Admin or owner required'}</button>
  </form>`;
}

function approvalRow(approval) {
  const status = approval.status || 'invalid';
  return `<div class="key-row"><div><strong>${escapeHtml(approval.tool)}</strong><span>${escapeHtml(approval.actionDigest.slice(0, 24))}…</span><small>Issued ${dateTime(approval.issuedAt)} · expires ${dateTime(approval.expiresAt)}${approval.consumedRequestId ? ` · request ${escapeHtml(approval.consumedRequestId)}` : ''}</small></div><div><span class="status-dot ${status === 'active' ? 'active' : status === 'consumed' ? 'revoked' : 'warning'}">${escapeHtml(status)}</span>${status === 'active' && project.permissions.approveActions ? `<button class="icon-button" title="Revoke approval" data-revoke-approval="${escapeHtml(approval.id)}">×</button>` : ''}</div></div>`;
}

function keyRow(key) {
  const status = key.status || 'invalid';
  return `<div class="key-row"><div><strong>${escapeHtml(key.name)}</strong><span>arl_live_${escapeHtml(key.key_prefix)}_••••••••</span><small>Created ${date(key.created_at)}${key.last_used_at ? ` · last used ${dateTime(key.last_used_at)}` : ' · never used'}</small></div><div><span class="status-dot ${status}">${status}</span>${status === 'active' && project.permissions.rotateKeys ? `<button class="icon-button" title="Revoke key" data-revoke-key="${escapeHtml(key.id)}">×</button>` : ''}</div></div>`;
}

function eventTable(events) {
  if (!events.length) return '<div class="empty-state"><p>No runtime requests have been screened.</p></div>';
  return `<div class="data-table"><div class="data-table-head"><span>Decision</span><span>Request</span><span>Surface</span><span>Rules</span><span>Latency</span><span>Time</span></div>${events.map((event) => `<div class="data-table-row"><span>${decisionEvidence(event)}</span><span><code>${escapeHtml(event.request_id)}</code></span><span>${escapeHtml(event.tool_name || 'content')}</span><span>${event.ruleIds.length ? event.ruleIds.map((id) => `<small class="rule-chip">${escapeHtml(id)}</small>`).join('') : '<small class="safe-text">clean</small>'}</span><span>${Number(event.evaluation_ms).toFixed(2)} ms</span><span>${dateTime(event.created_at)}</span></div>`).join('')}</div>`;
}

function decisionEvidence(event) {
  if (event.decision === 'allow' && event.observed_decision === 'would-deny')
    return `<b class="decision-chip allow">Allowed</b><small class="rule-chip">Would deny · ${escapeHtml(event.severity)}</small>`;
  return `<b class="decision-chip ${escapeHtml(event.decision)}">${event.decision === 'deny' ? 'Denied' : 'Allowed'}</b><small>Policy: ${event.observed_decision === 'would-deny' ? 'would deny' : 'allow'}</small>`;
}

function inventorySummary(snapshot) {
  const d = snapshot.drift || {};
  return `<div class="inventory-score"><strong>${snapshot.summary.total || 0}</strong><span>AI assets discovered</span></div><div class="inventory-metrics"><div><b>${snapshot.summary.production || 0}</b><span>Production</span></div><div><b>${snapshot.summary.internetExposed || 0}</b><span>Internet exposed</span></div><div><b>${snapshot.summary.privileged || 0}</b><span>Privileged</span></div></div><div class="drift-banner ${d.deploymentGate === 'review-required' ? 'warning' : 'clear'}"><strong>${d.deploymentGate === 'review-required' ? 'Deployment review required' : 'No risky exposure drift'}</strong><span>${d.added?.length || 0} added · ${d.removed?.length || 0} removed · ${d.changed?.length || 0} changed</span></div><div class="asset-list">${snapshot.assets.slice(0, 12).map((asset) => `<div><span class="asset-kind">${escapeHtml(asset.kind)}</span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.provider)} · ${escapeHtml(asset.environment)}${asset.privileged ? ' · privileged' : ''}${asset.internetExposed ? ' · public' : ''}</small></div>`).join('')}</div>`;
}

function inventoryHistory(items) {
  return items.map((item) => `<div class="history-row"><span>${dateTime(item.createdAt)}</span><strong>${item.summary.total || 0} assets</strong><span>${item.drift.added?.length || 0} added</span><span>${item.drift.changed?.length || 0} changed</span><span class="status-dot ${item.drift.deploymentGate === 'review-required' ? 'warning' : 'active'}">${escapeHtml(item.drift.deploymentGate || 'clear')}</span></div>`).join('');
}

function remediationRow(item) {
  const verification = item.verification || {};
  const evidenceLabel = verification.artifactEvidenceType === 'verified_artifact' ? `Verified artifact ${verification.artifactId}` :
    verification.reference ? `Customer-provided attestation: ${verification.reference} (unverified)` : 'Not attached';
  const retestLabel = verification.retestArtifactEvidenceType === 'verified_artifact' ? `Verified artifact ${verification.retestArtifactId}` :
    verification.retestReference ? `Customer-provided attestation: ${verification.retestReference} (unverified)` : 'Not attached';
  const upgrade = item.compatibilityState === 'evidence_upgrade_required'
    ? `<button class="button ghost small" data-evidence-upgrade="${escapeHtml(item.id)}">Start evidence upgrade</button>` : '';
  const owner = item.owner_email
    ? `<small>${escapeHtml(item.finding_key)} · ${escapeHtml(item.owner_email)}</small>`
    : `<small>${escapeHtml(item.finding_key)} · <strong>Owner required</strong></small>`;
  const ownerRepair = `<details class="remediation-edit"><summary>Edit details</summary><form class="mini-form remediation-owner-repair" data-remediation-owner-form="${escapeHtml(item.id)}"><div class="form-grid"><div class="field"><label for="severity-${escapeHtml(item.id)}">Severity</label><select id="severity-${escapeHtml(item.id)}" name="severity">${['critical','high','medium','low'].map((severity) => `<option value="${severity}" ${severity === item.severity ? 'selected' : ''}>${severity}</option>`).join('')}</select></div><div class="field"><label for="owner-${escapeHtml(item.id)}">Owner</label><input id="owner-${escapeHtml(item.id)}" name="ownerEmail" type="email" required autocomplete="email" value="${escapeHtml(item.owner_email || '')}" placeholder="Example: security@company.com"></div></div><button class="button primary small" type="submit">Save details</button><small>Changes are added to the project audit trail.</small></form></details>`;
  const assessmentGuide = assessmentRemediationGuide(item);
  const findingId = item.assessment_id === assessmentId ? item.finding_key?.split(':').at(-1) : '';
  const controlProgress = assessmentControlProgress.get(findingId);
  const lifecycleLabel = controlProgress?.latestResult === 'planned'
    ? 'Test planned'
    : controlProgress?.latestResult === 'inconclusive'
      ? 'Test inconclusive'
      : (item.compatibilityState || item.status).replaceAll('_', ' ');
  return `<details class="remediation-row" data-remediation-id="${escapeHtml(item.id)}"><summary><span class="severity-bar ${escapeHtml(item.severity)}"></span><div><strong>${escapeHtml(item.title)}</strong>${owner}</div><span class="status-pill">${escapeHtml(lifecycleLabel)}</span></summary><div class="remediation-detail">${ownerRepair}${assessmentGuide || `<p><strong>Implementation evidence:</strong> ${escapeHtml(evidenceLabel)}</p><p><strong>Retest evidence:</strong> ${escapeHtml(retestLabel)}</p><p><strong>Retest result:</strong> ${escapeHtml(verification.retestResult || 'Not run')}</p>${upgrade}<label>Next lifecycle step<select data-remediation-status="${escapeHtml(item.id)}"><option value="">Select next step</option>${nextRemediationOptions(item.status)}</select></label>`}</div></details>`;
}

function assessmentRemediationGuide(item) {
  if (!assessmentContext || item.assessment_id !== assessmentId) return '';
  const findingId = item.finding_key?.split(':').at(-1);
  const playbook = assessmentFixControl(findingId);
  if (!playbook) return '';
  const evidenceReady = ['evidence_attached', 'ready_for_retest', 'retested', 'verified_closed'].includes(item.status);
  const intelligenceParams = new URLSearchParams({ projectId: project.id, view: 'overview', assessment: assessmentId, finding: findingId, remediation: item.id });
  const matchedControlId = assessmentFixControl(findingId)?.controlId;
  if (matchedControlId) intelligenceParams.set('controlId', matchedControlId);
  const intelligenceHref = matchedControlId
    ? `/control-intelligence-control.html?${intelligenceParams.toString()}`
    : `/control-intelligence.html?${intelligenceParams.toString()}`;
  const controlProgress = assessmentControlProgress.get(findingId);
  const progressNote = controlProgress?.latestResult === 'inconclusive' ? '<div class="notice warning"><strong>Test inconclusive</strong><span>No control evidence was created. Connect the staging agent or give the developer test pack to the implementation owner, then rerun this exact test.</span></div>' : '';
  return `<section class="implementation-playbook">
    <div class="playbook-heading"><span class="eyebrow">Your implementation guide</span><h4>What done looks like</h4><p>${escapeHtml(playbook.outcome)}</p></div>
    <ol class="playbook-steps"><li><span>1</span><div><strong>Implement</strong><p>${escapeHtml(playbook.outcome)}</p></div></li><li><span>2</span><div><strong>Capture the right proof</strong><p>${escapeHtml(playbook.proof)}</p></div></li><li><span>3</span><div><strong>Test it</strong><p>${escapeHtml(playbook.test)}</p></div></li></ol>
    <div class="evidence-trust-note"><strong>${evidenceReady ? 'Evidence is linked' : 'No evidence linked yet'}</strong><span>${evidenceReady ? 'Continue with the recorded retest and verification state.' : 'An inventory snapshot is not accepted unless it proves this exact control. Record matching evidence in Control Intelligence; customer evidence remains unverified until it is integrity-bound and reviewed.'}</span></div>
    ${progressNote}
    <div class="button-row"><a class="button primary small" href="${intelligenceHref}">${evidenceReady ? 'Review evidence' : controlProgress?.started ? 'Continue evidence task' : 'Add matching evidence'}</a><button class="button ghost small" type="button" data-copy-playbook="${escapeHtml(findingId)}">Copy checklist</button></div>
    ${evidenceReady ? `<p><strong>Implementation evidence:</strong> ${escapeHtml(evidenceLabelFor(item))}</p><p><strong>Retest result:</strong> ${escapeHtml(item.verification?.retestResult || 'Not run')}</p><label>Next verified step<select data-remediation-status="${escapeHtml(item.id)}"><option value="">Choose when ready</option>${nextRemediationOptions(item.status)}</select></label>` : ''}
  </section>`;
}

function evidenceLabelFor(item) {
  const verification = item.verification || {};
  if (verification.artifactEvidenceType === 'verified_artifact') return `Verified artifact ${verification.artifactId}`;
  if (verification.reference) return `Customer-provided evidence ${verification.reference} (unverified)`;
  return 'Not attached';
}

function nextRemediationOptions(status) {
  const options = {
    open: [['evidence_attached', 'Attach evidence'], ['accepted_risk', 'Accept risk']],
    evidence_attached: [['ready_for_retest', 'Ready for retest'], ['open', 'Return to open']],
    ready_for_retest: [['retested', 'Record retest'], ['evidence_attached', 'Return to evidence']],
    retested: [['verified_closed', 'Verify closed'], ['ready_for_retest', 'Retest again']],
    verified_closed: [['open', 'Reopen']],
    accepted_risk: [['open', 'Reopen']],
    evidence_upgrade_required: [['ready_for_retest', 'Ready for compliant retest'], ['open', 'Reopen']],
  };
  return (options[status] || []).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function auditTable(items) {
  if (!items.length) return '<p class="muted">No project audit events yet.</p>';
  return `<div class="audit-list">${items.map((item) => `<div><span class="audit-icon">${auditIcon(item.action)}</span><span><strong>${escapeHtml(item.action.replaceAll('.', ' '))}</strong><small>${escapeHtml(item.actor_type)} · ${dateTime(item.created_at)}</small></span><code>${escapeHtml(item.target_id || item.project_id || '')}</code></div>`).join('')}</div>`;
}

function bind() {
  document.querySelector('#guidedProjectSelect')?.addEventListener('change', async (event) => {
    try { await loadProject(event.currentTarget.value); revealedKey = ''; revealedApproval = null; guidedCheck = null; render(); } catch (error) { fail(error); }
  });
  document.querySelectorAll('[data-project-id]').forEach((button) => button.addEventListener('click', async () => {
    try { await loadProject(button.dataset.projectId); revealedKey = ''; revealedApproval = null; render(); } catch (error) { fail(error); }
  }));
  document.querySelector('#assessmentProjectForm')?.addEventListener('submit', confirmAssessmentProject);
  document.querySelector('#createAssessmentRemediationCase')?.addEventListener('click', createAssessmentRemediationProject);
  document.querySelector('#assessmentFinding')?.addEventListener('change', syncAssessmentFinding);
  document.querySelector('#createProject')?.addEventListener('submit', createProject);
  document.querySelector('#createAssessmentCase')?.addEventListener('submit', createAssessmentCase);
  document.querySelector('#createKeyButton')?.addEventListener('click', createKey);
  document.querySelector('#approvalForm')?.addEventListener('submit', createApproval);
  document.querySelector('#policyForm')?.addEventListener('submit', savePolicy);
  document.querySelector('#inventoryForm')?.addEventListener('submit', saveInventory);
  document.querySelector('#remediationForm')?.addEventListener('submit', createRemediation);
  document.querySelector('#bulkRemediationForm')?.addEventListener('submit', createBulkRemediations);
  document.querySelectorAll('[data-open-remediation]').forEach((button) => button.addEventListener('click', openRemediation));
  document.querySelectorAll('[data-copy-playbook]').forEach((button) => button.addEventListener('click', copyRemediationPlaybook));
  document.querySelectorAll('[data-copy-package]').forEach((button) => button.addEventListener('click', copyRemediationPackage));
  document.querySelectorAll('[data-revoke-key]').forEach((button) => button.addEventListener('click', revokeKey));
  document.querySelectorAll('[data-revoke-approval]').forEach((button) => button.addEventListener('click', revokeApproval));
  document.querySelectorAll('[data-remediation-status]').forEach((select) => select.addEventListener('change', updateRemediation));
  document.querySelectorAll('[data-remediation-owner-form]').forEach((form) => form.addEventListener('submit', repairRemediationOwner));
  document.querySelectorAll('[data-evidence-upgrade]').forEach((button) => button.addEventListener('click', beginEvidenceUpgrade));
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', copyValue));
  document.querySelectorAll('#runGuidedCheck, #nextGuidedCheck').forEach((button) => button.addEventListener('click', runGuidedCheck));
  document.querySelectorAll('#toggleTechnicalMode, #showTechnicalControls').forEach((button) => button.addEventListener('click', toggleTechnicalMode));
  document.querySelectorAll('[data-open-technical]').forEach((button) => button.addEventListener('click', openTechnicalSection));
}

async function copyRemediationPackage(event) {
  const workPackage = assessmentWorkPackages.find((candidate) => candidate.id === event.currentTarget.dataset.copyPackage);
  if (!workPackage) return;
  const controls = workPackage.findings.map((findingId) => ({ findingId, control: assessmentFixControl(findingId) })).filter(({ control }) => control);
  const checklist = controls.map(({ findingId, control }) => `${findingId} · ${control.label}\nImplement: ${control.outcome}\nTest: ${control.test}\nProof: ${control.proof}`).join('\n\n');
  await navigator.clipboard.writeText(`${workPackage.title} — coordinated developer test pack\n\nOutcome\n${workPackage.outcome}\n\n${checklist}\n\nEvidence rule\nOne coordinated run may produce a shared evidence bundle, but each result must be mapped to its exact control and current snapshot. Each control still requires its own applicability decision, evidence review, retest and closure.`);
  event.currentTarget.textContent = 'Package test pack copied';
}

async function copyRemediationPlaybook(event) {
  const findingId = event.currentTarget.dataset.copyPlaybook;
  const playbook = assessmentFixControl(findingId);
  if (!playbook) return;
  await navigator.clipboard.writeText(`${findingId} remediation checklist\n\n1. Implement\n${playbook.outcome}\n\n2. Capture proof\n${playbook.proof}\n\n3. Retest\n${playbook.test}`);
  event.currentTarget.textContent = 'Checklist copied';
}

async function runGuidedCheck(event) {
  const button = event.currentTarget;
  setBusy(button, true, 'Running four safe checks…');
  errorBox.classList.remove('show');
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/guided-protection-check`, { method: 'POST', body: '{}' });
    guidedCheck = result.check;
    await loadProject(project.id);
    await loadOverview();
    render();
    document.querySelector('.guided-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    fail(error);
    setBusy(button, false);
  }
}

function toggleTechnicalMode() {
  technicalMode = !technicalMode;
  sessionStorage.setItem('arl_control_plane_mode', technicalMode ? 'technical' : 'guided');
  render();
  if (technicalMode) document.querySelector('#technicalControls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else document.querySelector('.customer-control-home')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openTechnicalSection(event) {
  technicalMode = true;
  sessionStorage.setItem('arl_control_plane_mode', 'technical');
  const section = event.currentTarget.dataset.openTechnical || 'runtime';
  render();
  history.replaceState(null, '', `#${section}`);
  document.querySelector(`#${CSS.escape(section)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function createProject(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Creating…');
  try {
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#projectName').value, environment: document.querySelector('#projectEnvironment').value }) });
    await loadOverview(); await loadProject(result.project.id); render();
  } catch (error) { fail(error); setBusy(button, false); }
}

async function confirmAssessmentProject(event) {
  event.preventDefault();
  const projectId = document.querySelector('#assessmentProjectSelect')?.value;
  if (!projectId) return fail(new Error('Choose the project that represents this exact assessed agent.'));
  try {
    await loadProject(projectId);
    assessmentProjectConfirmed = true;
    render();
    document.querySelector('#remediation')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { fail(error); }
}

async function createAssessmentRemediationProject(event) {
  const button = event.currentTarget;
  setBusy(button, true, 'Creating safe scope…');
  try {
    const canCreateCase = Boolean(overview.assessmentCases?.canCreate);
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({
      workspaceId: project?.workspaceId || undefined,
      name: assessmentContext.name,
      environment: assessmentEnvironment(assessmentContext),
      projectKind: canCreateCase ? 'assessment_case' : 'runtime',
    }) });
    await loadOverview();
    await loadProject(result.project.id);
    assessmentProjectConfirmed = true;
    render();
    document.querySelector('#remediation')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { fail(error); setBusy(button, false); }
}

function syncAssessmentFinding(event) {
  const finding = assessmentFindings().find((item) => item.id === event.currentTarget.value);
  if (!finding) return;
  document.querySelector('#remediationTitle').value = finding.recommendation;
  document.querySelector('#remediationSeverity').value = finding.severity;
  const proof = event.currentTarget.form?.querySelector('.microcopy');
  if (proof) proof.innerHTML = `<strong>Proof expected:</strong> ${escapeHtml(finding.verification)}`;
}

async function createAssessmentCase(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Creating assessment case…');
  try {
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({
      workspaceId: project?.workspaceId || undefined,
      name: document.querySelector('#assessmentCaseName').value,
      environment: 'development',
      projectKind: 'assessment_case',
    }) });
    location.href = `/control-intelligence.html?projectId=${encodeURIComponent(result.project.id)}`;
  } catch (error) { fail(error); setBusy(button, false); }
}

async function createKey(event) {
  setBusy(event.currentTarget, true, 'Issuing…');
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/keys`, { method: 'POST', body: JSON.stringify({ name: `Runtime key ${project.apiKeys.length + 1}` }) });
    revealedKey = result.key.token;
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); setBusy(event.currentTarget, false); }
}

async function revokeKey(event) {
  if (!confirm('Revoke this API key immediately? Requests using it will be rejected.')) return;
  try { await api(`/api/projects/${encodeURIComponent(project.id)}/keys/${encodeURIComponent(event.currentTarget.dataset.revokeKey)}/revoke`, { method: 'POST', body: '{}' }); await loadProject(project.id); render(); } catch (error) { fail(error); }
}


async function createApproval(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Issuing…');
  try {
    const args = JSON.parse(document.querySelector('#approvalArguments').value);
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/approvals`, {
      method: 'POST',
      body: JSON.stringify({
        ttlSeconds: Number(document.querySelector('#approvalTtl').value),
        toolCall: { name: document.querySelector('#approvalTool').value, arguments: args },
      }),
    });
    revealedApproval = { ...result.approval, arguments: args };
    await loadProject(project.id);
    render();
  } catch (error) {
    fail(error instanceof SyntaxError ? new Error('Approval arguments must be valid JSON.') : error);
    setBusy(button, false);
  }
}

async function revokeApproval(event) {
  if (!confirm('Revoke this exact-action approval immediately?')) return;
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/approvals/${encodeURIComponent(event.currentTarget.dataset.revokeApproval)}/revoke`, { method: 'POST', body: '{}' });
    if (revealedApproval?.id === event.currentTarget.dataset.revokeApproval) revealedApproval = null;
    await loadProject(project.id);
    render();
  } catch (error) { fail(error); }
}

async function savePolicy(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Publishing…');
  const policy = {
    mode: new FormData(event.currentTarget).get('mode'),
    allowedTools: csv(document.querySelector('#allowedTools').value),
    deniedTools: csv(document.querySelector('#deniedTools').value),
    allowedHosts: csv(document.querySelector('#allowedHosts').value),
    requireApprovalFor: csv(document.querySelector('#approvalActions').value),
    inspectInput: document.querySelector('#inspectInput').checked,
    inspectOutput: document.querySelector('#inspectOutput').checked,
    blockSecretLikeValues: document.querySelector('#blockSecrets').checked,
  };
  try { project = (await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ policy }) })).project; await loadOverview(); render(); } catch (error) { fail(error); setBusy(button, false); }
}

async function saveInventory(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Analysing…');
  try {
    const documents = JSON.parse(document.querySelector('#inventoryJson').value);
    await api(`/api/projects/${encodeURIComponent(project.id)}/inventory`, { method: 'POST', body: JSON.stringify({ source: document.querySelector('#inventorySource').value, documents }) });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error instanceof SyntaxError ? new Error('Inventory must be valid JSON.') : error); setBusy(button, false); }
}

async function createBulkRemediations(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const ownerInput = document.querySelector('#bulkRemediationOwner');
  const ownerEmail = ownerInput.value.trim();
  if (!ownerEmail) {
    ownerInput.setCustomValidity('Enter the person responsible for coordinating these fixes.');
    ownerInput.reportValidity();
    return;
  }
  const linkedKeys = new Set(linkedAssessmentRemediations(project, assessmentId).map((item) => item.finding_key));
  const remaining = assessmentFindings().filter((finding) => !linkedKeys.has(remediationFindingKey(assessmentId, finding)));
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, `Assigning ${remaining.length} fixes…`);
  errorBox.classList.remove('show');
  let created = 0;
  try {
    for (const finding of remaining) {
      await api(`/api/projects/${encodeURIComponent(project.id)}/remediations`, {
        method: 'POST',
        body: JSON.stringify({
          title: finding.recommendation,
          severity: finding.severity,
          ownerEmail,
          assessmentId,
          findingKey: remediationFindingKey(assessmentId, finding),
        }),
      });
      created += 1;
    }
    await loadProject(project.id); await loadOverview(); render();
    document.querySelector('.remediation-complete-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    await loadProject(project.id); await loadOverview(); render();
    fail(new Error(`${created} fix${created === 1 ? '' : 'es'} assigned before the process stopped. Nothing was duplicated. ${error.message}`));
  }
}

function openRemediation(event) {
  const row = document.querySelector(`[data-remediation-id="${CSS.escape(event.currentTarget.dataset.openRemediation)}"]`);
  const group = row?.closest('.remediation-group');
  if (group) group.open = true;
  if (row) {
    row.open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function createRemediation(event) {
  event.preventDefault();
  const ownerInput = document.querySelector('#remediationOwner');
  const ownerEmail = ownerInput?.value.trim() || '';
  if (assessmentContext && !ownerEmail) {
    ownerInput.setCustomValidity('Enter the person responsible for this fix.');
    ownerInput.reportValidity();
    ownerInput.addEventListener('input', () => ownerInput.setCustomValidity(''), { once: true });
    return;
  }
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Adding…');
  try {
    const finding = assessmentContext
      ? assessmentFindings().find((item) => item.id === document.querySelector('#assessmentFinding')?.value)
      : null;
    const payload = {
      title: document.querySelector('#remediationTitle').value,
      severity: document.querySelector('#remediationSeverity').value,
      ownerEmail,
      ...(finding ? {
        assessmentId,
        findingKey: remediationFindingKey(assessmentId, finding),
      } : {}),
    };
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations`, { method: 'POST', body: JSON.stringify(payload) });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); setBusy(button, false); }
}

async function repairRemediationOwner(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.ownerEmail;
  const ownerEmail = input.value.trim();
  if (!ownerEmail) {
    input.setCustomValidity('Enter the person responsible for this fix.');
    input.reportValidity();
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, 'Saving…');
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations/${encodeURIComponent(form.dataset.remediationOwnerForm)}`, {
      method: 'PATCH', body: JSON.stringify({ ownerEmail, severity: form.elements.severity.value }),
    });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); setBusy(button, false); }
}

async function updateRemediation(event) {
  const target = event.currentTarget;
  if (!target?.value) return;
  const remediationId = target.dataset.remediationStatus;
  target.disabled = true;
  const status = target.value;
  const verification = {};
  let retestCriteria;
  try {
    if (status === 'evidence_attached') {
      const sourceId = prompt('AgentRiskLayer inventory snapshot ID for the implemented change:') || '';
      const registered = await api(`/api/projects/${encodeURIComponent(project.id)}/remediations/${encodeURIComponent(remediationId)}/evidence`,
        { method: 'POST', body: JSON.stringify({ artifactType: 'implementation', sourceId }) });
      verification.artifactId = registered.artifact.id;
    }
    if (status === 'ready_for_retest') {
      retestCriteria = {
        ruleId: prompt('Required rule/control identifier (for example ARL-IN-001):') || '',
        expectedDecision: prompt('Expected server decision: allow or deny')?.trim().toLowerCase() || '',
        actionType: prompt('Action type: content.input, content.output or tool')?.trim().toLowerCase() || '',
        targetIdentity: prompt(`Constrained target (project:${project.id} for content, or exact tool name):`)?.trim().toLowerCase() || '',
        validityMinutes: 60,
      };
    }
    if (status === 'verified_closed') {
      const item = project.remediations.find((candidate) => candidate.id === remediationId);
      Object.assign(verification, item?.verification || {});
    }
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations/${encodeURIComponent(remediationId)}`, {
      method: 'PATCH', body: JSON.stringify({ status, verification: Object.keys(verification).length ? verification : undefined, retestCriteria }),
    });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); target.disabled = false; }
}

async function beginEvidenceUpgrade(event) {
  event.currentTarget.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations/${encodeURIComponent(event.currentTarget.dataset.evidenceUpgrade)}/evidence-upgrade`,
      { method: 'POST', body: JSON.stringify({ reason: 'Operator initiated trusted evidence upgrade' }) });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); event.currentTarget.disabled = false; }
}

function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!project || document.hidden || document.querySelector('form:focus-within')) return;
    try {
      const previousLatest = project.events[0]?.id;
      await loadProject(project.id);
      if (project.events[0]?.id !== previousLatest) { await loadOverview(); render(); }
    } catch {}
  }, 5000);
}

async function copyValue(event) {
  const type = event.currentTarget.dataset.copy;
  const value = type === 'key' ? revealedKey : type === 'approval' ? revealedApproval?.token || '' : curlExample();
  await navigator.clipboard.writeText(value);
  const original = event.currentTarget.textContent;
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => { event.currentTarget.textContent = original; }, 1200);
}

function curlExample() {
  const tool = revealedApproval?.tool || 'crm.read';
  const args = revealedApproval?.arguments || { customer_id: 'cust_123' };
  const approvalLine = revealedApproval?.token ? `,\n      \"approval_token\": \"${revealedApproval.token}\"` : '';
  return `curl -sS https://agentrisklayer.com/v1/guard \\\n  -H "Authorization: Bearer ${revealedKey || 'arl_live_YOUR_KEY'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "request_id": "agent-step-123",\n    "input": "Customer request and retrieved context",\n    "tool_call": {\n      "name": "${tool}",\n      "arguments": ${JSON.stringify(args)}${approvalLine}\n    },\n    "metadata": {"application": "support-agent"}\n  }'`;
}

function fail(error) {
  showError(errorBox, error.message || 'Unexpected error.');
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function csv(value) { return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))]; }
function plainEnvironment(value) { return ({ development: 'Still being built', test: 'Test environment', staging: 'Staging', production: 'Live production' })[String(value || '').toLowerCase()] || String(value || 'Project'); }
function formatNumber(value) { return new Intl.NumberFormat('en-GB').format(Number(value || 0)); }
function formatPercent(part, total) { return total ? `${((Number(part) / Number(total)) * 100).toFixed(1)}%` : '0%'; }
function date(value) { return value ? new Date(value).toLocaleDateString('en-GB') : '—'; }
function dateTime(value) { return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function auditIcon(action) { return action.includes('denied') ? '!' : action.includes('key') ? '⌘' : action.includes('inventory') ? '◇' : action.includes('policy') ? '⚙' : '✓'; }
