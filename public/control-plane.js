import { api, escapeHtml, setBusy, showError } from './shared.js';

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
const runtimeProjects = () => (overview?.projects || []).filter((item) => item.projectKind !== 'assessment_case');

const severityOrder = { critical: 1, high: 2, medium: 3, low: 4, none: 5 };

document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  location.href = '/';
});

init();

async function init() {
  if (['#runtime', '#policy', '#inventory', '#remediation', '#audit'].includes(location.hash)) technicalMode = true;
  try {
    await loadOverview();
    const availableRuntimeProjects = runtimeProjects();
    if (selectedProjectId && availableRuntimeProjects.some((item) => item.id === selectedProjectId)) await loadProject(selectedProjectId);
    else if (availableRuntimeProjects[0]) await loadProject(availableRuntimeProjects[0].id);
    render();
    startRefresh();
  } catch (error) {
    if (/sign in/i.test(error.message)) location.href = `/auth.html?next=${encodeURIComponent('/control-plane.html')}`;
    else fail(error);
  }
}

async function loadOverview() {
  overview = await api('/api/control-plane/overview');
}

async function loadProject(projectId) {
  project = (await api(`/api/projects/${encodeURIComponent(projectId)}`)).project;
  selectedProjectId = projectId;
  sessionStorage.setItem('arl_selected_project', projectId);
}

function render() {
  root.className = '';
  root.innerHTML = technicalMode
    ? `${overviewHeader()}<div class="control-plane-layout technical-mode">${projectRail()}<section class="control-plane-main">${project ? projectView() : emptyProject()}</section></div>`
    : `<div class="guided-control-layout">${project ? `${guidedProjectContext()}${projectView()}` : emptyProject()}</div>`;
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
  return `<details class="remediation-row"><summary><span class="severity-bar ${escapeHtml(item.severity)}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.finding_key)}${item.owner_email ? ` · ${escapeHtml(item.owner_email)}` : ''}</small></div><span class="status-pill">${escapeHtml((item.compatibilityState || item.status).replaceAll('_', ' '))}</span></summary><div class="remediation-detail"><p><strong>Implementation evidence:</strong> ${escapeHtml(evidenceLabel)}</p><p><strong>Retest evidence:</strong> ${escapeHtml(retestLabel)}</p><p><strong>Retest result:</strong> ${escapeHtml(verification.retestResult || 'Not run')}</p>${upgrade}<label>Next lifecycle step<select data-remediation-status="${escapeHtml(item.id)}"><option value="">Select next step</option>${nextRemediationOptions(item.status)}</select></label></div></details>`;
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
  document.querySelector('#createProject')?.addEventListener('submit', createProject);
  document.querySelector('#createAssessmentCase')?.addEventListener('submit', createAssessmentCase);
  document.querySelector('#createKeyButton')?.addEventListener('click', createKey);
  document.querySelector('#approvalForm')?.addEventListener('submit', createApproval);
  document.querySelector('#policyForm')?.addEventListener('submit', savePolicy);
  document.querySelector('#inventoryForm')?.addEventListener('submit', saveInventory);
  document.querySelector('#remediationForm')?.addEventListener('submit', createRemediation);
  document.querySelectorAll('[data-revoke-key]').forEach((button) => button.addEventListener('click', revokeKey));
  document.querySelectorAll('[data-revoke-approval]').forEach((button) => button.addEventListener('click', revokeApproval));
  document.querySelectorAll('[data-remediation-status]').forEach((select) => select.addEventListener('change', updateRemediation));
  document.querySelectorAll('[data-evidence-upgrade]').forEach((button) => button.addEventListener('click', beginEvidenceUpgrade));
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', copyValue));
  document.querySelectorAll('#runGuidedCheck, #nextGuidedCheck').forEach((button) => button.addEventListener('click', runGuidedCheck));
  document.querySelectorAll('#toggleTechnicalMode, #showTechnicalControls').forEach((button) => button.addEventListener('click', toggleTechnicalMode));
  document.querySelectorAll('[data-open-technical]').forEach((button) => button.addEventListener('click', openTechnicalSection));
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

async function createRemediation(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Adding…');
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations`, { method: 'POST', body: JSON.stringify({ title: document.querySelector('#remediationTitle').value, severity: document.querySelector('#remediationSeverity').value, ownerEmail: document.querySelector('#remediationOwner').value }) });
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
