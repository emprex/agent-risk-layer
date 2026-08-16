import { api, escapeHtml, money, riskClass, setBusy, showError } from './shared.js';
import { assessmentProjects, matchingAssessmentProject } from './assessment-remediation.js';
import { dashboardEvidencePresentation } from './dashboard-evidence-state.js';

const root = document.querySelector('#dashboardRoot');
let dashboardData;
let pendingMfaSecret = '';
let selectedGroup = null;

async function init() {
  try {
    dashboardData = await api('/api/dashboard');
    const data = dashboardData;
    const groups = groupAssessments(data.assessments || []);
    selectedGroup = chooseAgentGroup(groups);
    root.className = '';
    root.innerHTML = renderWorkspace(data, groups, selectedGroup);
    wireEvents();
    if (location.hash === '#settings') document.querySelector('#settings')?.setAttribute('open', '');
    const registrationNotice = sessionStorage.getItem('arl_registration_notice');
    if (registrationNotice) {
      document.querySelector('#settings')?.setAttribute('open', '');
      accountMessage(registrationNotice);
      sessionStorage.removeItem('arl_registration_notice');
    }
    await hydrateDeploymentEvidence(data, selectedGroup);
  } catch (error) {
    if (error.message.includes('Sign in')) location.href = `/auth.html?next=${encodeURIComponent('/dashboard.html')}`;
    else root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

function assessmentLink(assessment) {
  return `/result.html?id=${encodeURIComponent(assessment.id)}&token=${encodeURIComponent(assessment.access_token)}`;
}

function isIncompleteAssessment(assessment) {
  return String(assessment.risk_band || assessment.riskBand || '').toLowerCase() === 'undetermined';
}

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function groupAssessments(assessments) {
  const groups = new Map();
  for (const assessment of assessments) {
    const key = `${normalise(assessment.name)}::${normalise(assessment.agent_type)}`;
    if (!groups.has(key)) groups.set(key, { key, name: assessment.name, agentType: assessment.agent_type, assessments: [] });
    groups.get(key).assessments.push(assessment);
  }
  return [...groups.values()];
}

function chooseAgentGroup(groups) {
  if (!groups.length) return null;
  const params = new URLSearchParams(location.search);
  const requestedAssessment = params.get('assessment') || sessionStorage.getItem('arl_selected_assessment') || '';
  const selected = groups.find((group) => group.assessments.some((assessment) => assessment.id === requestedAssessment)) || groups[0];
  const latest = selected.assessments[0];
  if (latest?.id) sessionStorage.setItem('arl_selected_assessment', latest.id);
  return selected;
}

function matchingProject(data, assessment) {
  if (!assessment) return null;
  return matchingAssessmentProject(data.controlPlane || {}, {
    name: assessment.name,
    agentType: assessment.agent_type,
  });
}

function assessmentPosture(assessment) {
  if (!assessment) return { state: 'unresolved', title: 'Not assessed', detail: 'Run an assessment to establish the current declared posture.' };
  if (isIncompleteAssessment(assessment)) {
    return { state: 'information', title: 'Information required', detail: 'Material assessment context is still unknown. Unknown information is not a vulnerability.' };
  }
  const band = String(assessment.risk_band || 'Not determined');
  const state = normalise(band) === 'critical' ? 'critical' : ['high', 'moderate'].includes(normalise(band)) ? 'hold' : 'unresolved';
  return { state, title: `${band} declared risk`, detail: `${assessment.score}/100 aggregate assessment score. This is not a deployment decision.` };
}

function nextActionForAssessment(assessment, project) {
  if (!assessment) return { title: 'Assess one AI agent', detail: 'Describe its current access, data, actions and safeguards.', label: 'Start assessment', href: '/assessment.html' };
  if (isIncompleteAssessment(assessment)) return { title: 'Complete the missing security information', detail: 'Confirm unknown architecture and control facts with the agent owner before relying on a deployment posture.', label: 'Review missing information', href: assessmentLink(assessment) };
  const band = normalise(assessment.risk_band);
  if (band === 'critical' || band === 'high') return { title: 'Review the highest-priority declared weaknesses', detail: 'Open the current result, then create remediation work only for weaknesses actually supported by the assessment.', label: 'Open current result', href: assessmentLink(assessment) };
  if (project) return { title: 'Review deployment evidence for this exact agent', detail: 'Check applicable controls, evidence, tests, remediation and the current server-recorded deployment decision.', label: 'Open deployment evidence', href: `/control-intelligence.html?projectId=${encodeURIComponent(project.id)}` };
  if (assessment.latest_inspection_summary) return { title: 'Review the latest observed evidence', detail: 'The assessment has technical inspection evidence. Review what it observed and whether the assessed version changed.', label: 'Open evidence', href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}` };
  return { title: 'Add evidence when stronger assurance is needed', detail: 'The assessment is still primarily declared information until it is linked to reviewed or repeatable evidence.', label: 'Add technical evidence', href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}` };
}

function renderWorkspace(data, groups, group) {
  const latest = group?.assessments?.[0] || null;
  const project = matchingProject(data, latest);
  if (project?.id) sessionStorage.setItem('arl_selected_project', project.id);
  const posture = assessmentPosture(latest);
  const next = nextActionForAssessment(latest, project);
  return `
    ${verificationBanner(data.user)}
    ${group ? agentCommandHtml(group, latest, project, posture, next, groups) : emptyAgentWorkspace()}
    ${group ? agentEvidenceSummary(group, latest, project) : ''}
    ${group ? assessmentHistory(group) : ''}
    ${allAgentsHtml(groups, group)}
    ${workspaceSecondary(data)}
    ${settingsHtml(data)}
  `;
}

function agentCommandHtml(group, latest, project, posture, next, groups) {
  const projectQuery = project?.id ? `?projectId=${encodeURIComponent(project.id)}` : '';
  const findingsHref = `/control-plane.html?assessment=${encodeURIComponent(latest.id)}#remediation`;
  const evidenceHref = `/inspector.html?assessment=${encodeURIComponent(latest.id)}`;
  const runtimeHref = project?.id ? `/control-plane.html?projectId=${encodeURIComponent(project.id)}#runtime` : '/control-plane.html#runtime';
  const deploymentHref = project?.id ? `/control-intelligence.html?projectId=${encodeURIComponent(project.id)}` : assessmentLink(latest);
  return `<section class="workspace-agent-command" aria-labelledby="activeAgentTitle">
    <div class="workspace-agent-command-head">
      <div class="workspace-agent-identity"><span class="eyebrow">Current agent</span><h2 id="activeAgentTitle">${escapeHtml(group.name)}</h2><p>${escapeHtml(group.agentType)} · latest assessment ${new Date(latest.created_at).toLocaleDateString('en-GB')}${project ? ` · ${escapeHtml(project.environment || project.projectKind || 'project')}` : ''}</p></div>
      ${groups.length > 1 ? `<div class="workspace-agent-selector"><label for="workspaceAgentSelect">Switch agent</label><select id="workspaceAgentSelect">${groups.map((item) => `<option value="${escapeHtml(item.assessments[0].id)}" ${item.key === group.key ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.agentType)}</option>`).join('')}</select></div>` : ''}
    </div>
    <div class="workspace-status-grid">
      <div class="workspace-status-card" id="deploymentEvidenceState" data-state="unresolved"><small>Deployment evidence</small><strong>${project ? 'Loading recorded decision…' : 'No linked decision'}</strong><p>${project ? 'Reading the server-recorded decision for this exact project.' : 'This assessment is not yet linked to a matching evidence project. No deployment state is inferred.'}</p></div>
      <div class="workspace-status-card" data-state="${escapeHtml(posture.state)}"><small>Latest assessment</small><strong>${escapeHtml(posture.title)}</strong><p>${escapeHtml(posture.detail)}</p></div>
      <div class="workspace-next-action" id="dashboardNextAction"><small>Next action</small><strong>${escapeHtml(next.title)}</strong><p>${escapeHtml(next.detail)}</p><a class="button primary small" href="${next.href}">${escapeHtml(next.label)}</a></div>
    </div>
    <nav class="workspace-local-nav" data-local-navigation aria-label="${escapeHtml(group.name)} workspace"><a href="/dashboard.html?assessment=${encodeURIComponent(latest.id)}" aria-current="page">Summary</a><a href="${findingsHref}">Findings</a><a href="${deploymentHref}">${project ? 'Controls' : 'Assessment'}</a><a href="${evidenceHref}">Evidence</a><a href="${runtimeHref}">Runtime</a><a href="#agentHistory">History</a></nav>
  </section>`;
}

function emptyAgentWorkspace() {
  return `<section class="workspace-agent-command"><div class="workspace-empty"><span class="eyebrow">No agent assessed yet</span><h2>Start with one AI agent.</h2><p>Describe the current system and AgentRiskLayer will keep unknown information separate from confirmed weaknesses.</p><a class="button primary" href="/assessment.html">Assess my first agent</a></div></section>`;
}

function agentEvidenceSummary(group, assessment, project) {
  const inspection = assessment.latest_inspection_summary;
  const redteam = assessment.latest_redteam_summary;
  return `<div class="workspace-content-grid">
    <section class="workspace-section"><div class="workspace-section-heading"><div><span class="eyebrow">Why this is the current posture</span><h2>What is known now</h2><p>Declared assessment state stays separate from observed and test-generated evidence.</p></div></div><div class="workspace-signal-grid" id="agentEvidenceSignals">
      <div class="workspace-signal"><small>Declared assessment</small><strong>${isIncompleteAssessment(assessment) ? 'Information incomplete' : `${escapeHtml(assessment.risk_band)} · ${assessment.score}/100`}</strong></div>
      <div class="workspace-signal"><small>Observed evidence</small><strong>${inspection ? 'Inspection recorded' : 'No inspection recorded'}</strong></div>
      <div class="workspace-signal"><small>Attack-test evidence</small><strong>${redteam ? 'Test run recorded' : 'No attack test recorded'}</strong></div>
    </div></section>
    <aside class="workspace-section"><span class="eyebrow">Scope</span><h3>${escapeHtml(group.name)}</h3><p class="muted">${project ? `Linked project: ${escapeHtml(project.name)}` : 'No exact-name evidence project is linked from this dashboard view.'}</p><p class="muted small-copy">Assessment, observed evidence and runtime evidence keep their own provenance. Absence of evidence is not converted into a vulnerability.</p></aside>
  </div>`;
}

function assessmentHistory(group) {
  const [latest, ...history] = group.assessments;
  return `<section class="workspace-section section-gap" id="agentHistory"><div class="workspace-section-heading"><div><span class="eyebrow">Assessment history</span><h2>${escapeHtml(group.name)}</h2><p>The newest assessment is shown first. Earlier records remain immutable history.</p></div><a class="button ghost small" href="${assessmentLink(latest)}">Open current result</a></div>
    ${history.length ? `<details class="workspace-history"><summary><span>Previous assessments (${history.length})</span><span>View history</span></summary><div class="workspace-history-body workspace-agent-list">${history.map((assessment) => assessmentHistoryRow(assessment)).join('')}</div></details>` : '<p class="muted">No previous assessment for this agent.</p>'}
  </section>`;
}

function assessmentHistoryRow(assessment) {
  const status = isIncompleteAssessment(assessment) ? 'Information required' : `${assessment.risk_band} · ${assessment.score}/100`;
  return `<article class="workspace-agent-row"><div><h3>${escapeHtml(status)}</h3><p>${new Date(assessment.created_at).toLocaleDateString('en-GB')} · ${escapeHtml(assessment.scoring_version || 'assessment')}</p></div><div class="workspace-agent-row-actions"><a class="button ghost small" href="${assessmentLink(assessment)}">Open</a><button class="icon-button" title="Delete assessment" aria-label="Delete ${escapeHtml(assessment.name)} assessment from ${new Date(assessment.created_at).toLocaleDateString('en-GB')}" data-delete-assessment="${escapeHtml(assessment.id)}">×</button></div></article>`;
}

function allAgentsHtml(groups, selected) {
  if (!groups.length) return '';
  return `<section class="workspace-section section-gap"><div class="workspace-section-heading"><div><span class="eyebrow">All agents</span><h2>${groups.length} ${groups.length === 1 ? 'agent' : 'agents'} in this account</h2><p>Each row shows the latest assessment only. Open History on an agent for older records.</p></div></div><div class="workspace-agent-list">${groups.map((group) => {
    const latest = group.assessments[0];
    const state = isIncompleteAssessment(latest) ? 'Information required' : `${latest.risk_band} · ${latest.score}/100`;
    return `<article class="workspace-agent-row"><div><h3>${escapeHtml(group.name)}${group.key === selected?.key ? ' · Current' : ''}</h3><p>${escapeHtml(group.agentType)} · ${escapeHtml(state)} · checked ${new Date(latest.created_at).toLocaleDateString('en-GB')}</p></div><div class="workspace-agent-row-actions"><a class="button ${group.key === selected?.key ? 'ghost' : 'primary'} small" href="/dashboard.html?assessment=${encodeURIComponent(latest.id)}">${group.key === selected?.key ? 'Viewing' : 'Open agent'}</a></div></article>`;
  }).join('')}</div></section>`;
}

function workspaceSecondary(data) {
  return `<details class="workspace-secondary"><summary><span>Specialist tools and supporting progress</span><small>Inspector, Control Intelligence, runtime, risk library and workflow status</small></summary><div class="workspace-secondary-body">${progressOverview(data)}${advancedTools(data)}</div></details>`;
}

function settingsHtml(data) {
  return `<details id="settings" class="workspace-secondary section-gap"><summary><span>Account, plan and privacy settings</span><small>Billing, MFA, data export and owner operations</small></summary><div class="workspace-secondary-body">
    ${data.user.isSuperuser ? '<div class="workspace-admin-note"><strong>Owner access is active.</strong> Production owner operations remain MFA-gated. <a class="text-link" href="/admin.html">Open owner operations</a></div>' : ''}
    <div class="dashboard-grid section-gap"><section class="panel"><div class="section-heading compact-heading"><div><span class="eyebrow">Plan</span><h2>Plan and billing</h2></div><a class="button ghost small" href="/pricing.html">Compare plans</a></div>${subscriptionHtml(data.subscription, data.controlPlane?.entitlement)}</section><section class="panel"><h2>Payment and report delivery</h2>${data.purchases.length ? data.purchases.slice(0, 12).map(purchaseHtml).join('') : '<p class="muted">No payments yet.</p>'}</section></div>
    <section class="panel section-gap account-settings"><div class="section-heading compact-heading"><div><span class="eyebrow">Account security</span><h2>Privacy and account settings</h2></div><a class="button ghost small" href="/api/account/export">Download my data</a></div><div id="accountMessage" class="success-box" hidden></div><div id="accountError" class="error-box"></div><div class="settings-grid">${mfaHtml(data.user)}<form id="passwordForm" class="auth-form settings-card"><h3>Change password</h3><div class="field"><label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="newPassword">New password</label><input id="newPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div><button class="button ghost" type="submit">Update password</button></form><form id="deleteAccountForm" class="auth-form settings-card danger-zone"><h3>Delete account</h3><p class="muted small-copy">Permanently removes account data. Active subscriptions must be cancelled first.</p><div class="field"><label for="deletePassword">Password</label><input id="deletePassword" type="password" autocomplete="current-password" required></div>${data.user.mfaEnabled ? '<div class="field"><label for="deleteMfaCode">Authenticator or recovery code</label><input id="deleteMfaCode" type="text" autocomplete="one-time-code" required></div>' : ''}<div class="field"><label for="deleteConfirmation">Type DELETE</label><input id="deleteConfirmation" type="text" required autocomplete="off"></div><button class="button danger" type="submit">Delete account permanently</button></form></div></section>
  </div></details>`;
}

function updateDashboardNextAction(action) {
  if (!action) return;
  const next = document.querySelector('#dashboardNextAction');
  if (!next) return;
  next.querySelector('strong').textContent = action.title;
  next.querySelector('p').textContent = action.detail;
  const link = next.querySelector('a');
  if (link) {
    link.textContent = action.label;
    link.href = action.href;
  }
}

function updateRuntimeEvidenceSignal(message) {
  if (!message) return;
  const signals = document.querySelector('#agentEvidenceSignals');
  if (!signals) return;
  let signal = document.querySelector('#runtimeEvidenceSignal');
  if (!signal) {
    signal = document.createElement('div');
    signal.className = 'workspace-signal';
    signal.id = 'runtimeEvidenceSignal';
    const label = document.createElement('small');
    label.textContent = 'Runtime evidence';
    const value = document.createElement('strong');
    signal.append(label, value);
    signals.append(signal);
  }
  signal.querySelector('strong').textContent = message;
}

async function hydrateDeploymentEvidence(data, group) {
  const assessment = group?.assessments?.[0];
  const project = matchingProject(data, assessment);
  const card = document.querySelector('#deploymentEvidenceState');
  if (!project || !card) return;
  try {
    const [controlIntelligenceResult, projectResult] = await Promise.allSettled([
      api(`/api/projects/${encodeURIComponent(project.id)}/control-intelligence?limit=1`),
      api(`/api/projects/${encodeURIComponent(project.id)}`),
    ]);
    if (group !== selectedGroup) return;
    if (controlIntelligenceResult.status !== 'fulfilled') throw controlIntelligenceResult.reason;
    const payload = controlIntelligenceResult.value;
    const exactProject = projectResult.status === 'fulfilled' ? projectResult.value?.project : null;
    const deployment = payload.deploymentState || null;
    const summary = payload.summary || {};
    const presentation = dashboardEvidencePresentation({
      journey: exactProject?.journey || null,
      hasDeploymentDecision: Boolean(deployment?.decision),
      projectId: project.id,
    });
    if (!deployment?.decision) {
      if (presentation.deployment) {
        card.dataset.state = presentation.deployment.state;
        card.querySelector('strong').textContent = presentation.deployment.title;
        card.querySelector('p').textContent = presentation.deployment.detail;
      } else {
        card.dataset.state = 'unresolved';
        card.querySelector('strong').textContent = 'No decision recorded';
        card.querySelector('p').textContent = 'The project exists, but no current server-recorded deployment decision is available. No HOLD or PROCEED state is inferred.';
      }
    } else {
      const decision = String(deployment.decision).replaceAll('_', ' ');
      const normalised = normalise(deployment.decision).replaceAll('_', ' ');
      card.dataset.state = normalised.includes('proceed') ? 'proceed' : normalised.includes('do not') ? 'stop' : 'hold';
      card.querySelector('strong').textContent = decision;
      card.querySelector('p').textContent = deployment.rationale || 'Server-recorded deployment decision.';
    }
    updateDashboardNextAction(presentation.nextAction);
    updateRuntimeEvidenceSignal(presentation.runtimeEvidence);
    const signals = document.querySelector('#agentEvidenceSignals');
    if (signals) {
      const blockers = summary.deploymentBlockers;
      const missing = summary.controlsMissingEvidence;
      const findings = summary.findingsAwaitingRemediation;
      signals.insertAdjacentHTML('beforeend', `${blockers != null ? `<div class="workspace-signal"><small>Deployment blockers</small><strong>${Number(blockers)}</strong></div>` : ''}${missing != null ? `<div class="workspace-signal"><small>Controls missing evidence</small><strong>${Number(missing)}</strong></div>` : ''}${findings != null ? `<div class="workspace-signal"><small>Open evidence-chain findings</small><strong>${Number(findings)}</strong></div>` : ''}`);
    }
  } catch (error) {
    card.dataset.state = 'unresolved';
    card.querySelector('strong').textContent = 'Decision unavailable';
    card.querySelector('p').textContent = `Could not load the current deployment evidence: ${error.message}`;
  }
}

function progressOverview(data) {
  const assessments = data.assessments || [];
  const totals = data.controlPlane?.totals || {};
  const assessed = Number(data.stats.assessments || 0) > 0;
  const urgent = Number(data.stats.critical || 0);
  const incompleteCount = assessments.filter(isIncompleteAssessment).length;
  const openFixes = Number(totals.openRemediations || 0);
  const protectedRequests = Number(totals.runtimeRequestsMonth || 0);
  const reviewStep = incompleteCount
    ? { label: 'Complete missing information', complete: false, detail: `${incompleteCount} incomplete ${incompleteCount === 1 ? 'check needs' : 'checks need'} clarification`, href: '/dashboard.html' }
    : { label: 'Address urgent findings', complete: assessed && urgent === 0, detail: urgent ? `${urgent} critical ${urgent === 1 ? 'result needs' : 'results need'} attention` : assessed ? 'No critical result recorded' : 'Complete a check first', href: '/dashboard.html' };
  const steps = [
    { label: 'Assess', complete: assessed, detail: assessed ? `${Number(data.stats.assessments || 0)} saved assessments` : 'No agent assessed yet', href: '/assessment.html' },
    reviewStep,
    { label: 'Remediate and retest', complete: assessed && incompleteCount === 0 && openFixes === 0, detail: incompleteCount ? 'Clarify missing information first' : openFixes ? `${openFixes} open ${openFixes === 1 ? 'fix' : 'fixes'}` : assessed ? 'No open fix recorded' : 'No work recorded yet', href: '/control-plane.html#remediation' },
    { label: 'Runtime evidence', complete: protectedRequests > 0, detail: protectedRequests ? `${protectedRequests.toLocaleString('en-GB')} decisions this month` : 'No runtime decision recorded yet', href: '/control-plane.html#runtime' },
  ];
  return `<section class="panel section-gap"><div class="section-heading compact-heading"><div><span class="eyebrow">Supporting workflow status</span><h2>Evidence journey</h2><p>This is workflow progress, not an automatic deployment approval.</p></div></div><ol class="v10-task-list">${steps.map((step, index) => `<li class="${step.complete ? 'complete' : ''}"><a href="${step.href}"><span>${step.complete ? '✓' : index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div><b>${step.complete ? 'Recorded' : 'Next'}</b></a></li>`).join('')}</ol></section>`;
}

function advancedTools(data) {
  const projects = assessmentProjects(data.controlPlane || {});
  const readinessLinks = projects.slice(0, 5).map((project) => `<a href="/risk-readiness.html?projectId=${encodeURIComponent(project.id)}"><strong>${escapeHtml(project.name)} readiness</strong><span>Applicability, evidence states and deployment gates</span></a>`).join('');
  return `<section class="panel section-gap"><div class="section-heading compact-heading"><div><span class="eyebrow">Specialist views</span><h2>Technical tools</h2><p>Open these when you need deeper evidence, testing or runtime policy detail.</p></div></div><div class="technical-tool-grid"><a href="/control-intelligence.html"><strong>Deployment evidence</strong><span>Controls, tests, evidence chain and server-recorded decision</span></a><a href="/inspector.html"><strong>Technical inspection</strong><span>Local, read-only observed evidence</span></a><a href="/redteam.html"><strong>Attack simulation</strong><span>Controlled tests for authorised systems</span></a><a href="/control-plane.html#runtime"><strong>Runtime</strong><span>Policies, approvals and runtime decisions</span></a><a href="/risk-library.html"><strong>Risk library</strong><span>Problem, bounded check and remediation guidance</span></a>${readinessLinks}</div></section>`;
}

function verificationBanner(user) {
  if (user.emailVerified) return '';
  return `<section class="notice verification-banner"><div><strong>Verify your email to use paid and technical workflows</strong><p>Your saved assessments remain available. Verification protects report purchases, local inspection and attack-test authorisations.</p></div><button id="resendVerification" class="button ghost small">Resend verification email</button></section>`;
}

function purchaseHtml(purchase) {
  const fulfilment = purchase.fulfilment_state === 'fulfilled' ? 'Access granted' : `Fulfilment ${purchase.fulfilment_state}`;
  const email = purchase.email_state === 'sent' || purchase.email_state === 'simulated' ? 'Email delivered' : purchase.email_state === 'dead' ? 'Email needs support' : `Email ${purchase.email_state}`;
  const problem = purchase.fulfilment_error || purchase.email_error;
  return `<div class="assessment-row"><div><strong>${escapeHtml(purchase.product_key.replaceAll('_', ' '))}</strong><div class="assessment-meta"><span>${new Date(purchase.created_at).toLocaleDateString('en-GB')}</span><span>${escapeHtml(fulfilment)}</span><span>${escapeHtml(email)}</span></div>${problem ? `<p class="fail-text small-copy">${escapeHtml(problem)}</p>` : ''}</div><span>${money(purchase.amount_pence, false, purchase.currency)}</span></div>`;
}

function subscriptionHtml(subscription, entitlement = {}) {
  if (dashboardData?.user?.isSuperuser) return `<div class="subscription-card"><strong>Owner access</strong><p class="muted">Reports and technical tools are enabled for the owner account. Production owner operations still require MFA.</p><a class="button ghost full" href="/admin.html">Owner operations</a></div>`;
  if (!subscription) return `<div class="subscription-card"><strong>${escapeHtml(entitlement.name || 'Current plan')}</strong><p class="muted">${Number(entitlement.projects || 0)} active project allowance · ${Number(entitlement.runtimeRequestsPerMonth || 0).toLocaleString('en-GB')} Guard decisions/month · ${Number(entitlement.retentionDays || 0)}-day retention.</p><a class="button ghost full" href="/pricing.html">Compare plans</a></div>`;
  return `<div class="subscription-card"><strong>${escapeHtml(entitlement.name || subscription.plan_key.replaceAll('_', ' '))}</strong><p class="muted">Status: ${escapeHtml(subscription.status)}${subscription.current_period_end ? `<br>Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB')}` : ''}</p><button class="button ghost full" id="billingPortal">Manage billing</button>${subscription.stripe_subscription_id?.startsWith('demo_') && subscription.status === 'active' ? '<button class="button danger full" id="cancelDemo">Cancel demo plan</button>' : ''}</div>`;
}

function mfaHtml(user) {
  if (user.mfaEnabled) return `<form id="mfaDisableForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="pass-text">Enabled</p><p class="muted small-copy">A TOTP authenticator or unused recovery code is required at sign-in.</p><div class="field"><label for="mfaDisablePassword">Password</label><input id="mfaDisablePassword" type="password" required autocomplete="current-password"></div><div class="field"><label for="mfaDisableCode">Authenticator or recovery code</label><input id="mfaDisableCode" type="text" required autocomplete="one-time-code"></div><button class="button danger" type="submit">Disable MFA</button></form>`;
  if (!user.emailVerified) return `<section class="settings-card"><h3>Multi-factor authentication</h3><p class="muted">Verify your email before enabling MFA.</p></section>`;
  return `<form id="mfaSetupForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="muted small-copy">Protect your account with any TOTP authenticator app.</p><div class="field"><label for="mfaSetupPassword">Password</label><input id="mfaSetupPassword" type="password" required autocomplete="current-password"></div><button class="button ghost" type="submit">Start MFA setup</button><div id="mfaSetupDetails" hidden><div class="field"><label for="mfaSecret">Manual setup secret</label><input id="mfaSecret" readonly></div><p class="muted small-copy">Add the secret to your authenticator, then enter the six-digit code.</p><div class="field"><label for="mfaEnableCode">Authentication code</label><input id="mfaEnableCode" type="text" inputmode="numeric" autocomplete="one-time-code"></div><button id="enableMfaButton" class="button primary" type="button">Enable MFA</button></div></form>`;
}

function wireEvents() {
  document.querySelector('#workspaceAgentSelect')?.addEventListener('change', (event) => {
    const assessmentId = event.target.value;
    sessionStorage.setItem('arl_selected_assessment', assessmentId);
    location.href = `/dashboard.html?assessment=${encodeURIComponent(assessmentId)}`;
  });
  document.querySelector('#resendVerification')?.addEventListener('click', resendVerification);
  document.querySelector('#billingPortal')?.addEventListener('click', billingPortal);
  document.querySelector('#cancelDemo')?.addEventListener('click', cancelDemo);
  document.querySelectorAll('[data-delete-assessment]').forEach((button) => button.addEventListener('click', deleteAssessment));
  document.querySelector('#passwordForm')?.addEventListener('submit', updatePassword);
  document.querySelector('#deleteAccountForm')?.addEventListener('submit', deleteAccount);
  document.querySelector('#mfaSetupForm')?.addEventListener('submit', setupMfa);
  document.querySelector('#enableMfaButton')?.addEventListener('click', enableMfa);
  document.querySelector('#mfaDisableForm')?.addEventListener('submit', disableMfa);
}

async function resendVerification(event) { setBusy(event.currentTarget, true, 'Sending…'); try { await api('/api/auth/verification/resend', { method: 'POST', body: '{}' }); accountMessage('Verification email sent.'); } catch (error) { accountError(error.message); } finally { setBusy(event.currentTarget, false); } }
async function billingPortal(event) { setBusy(event.currentTarget, true, 'Opening…'); try { const { url } = await api('/api/billing/portal', { method: 'POST', body: '{}' }); location.href = url; } catch (error) { accountError(error.message); setBusy(event.currentTarget, false); } }
async function cancelDemo(event) { if (!confirm('Cancel the demo subscription?')) return; setBusy(event.currentTarget, true, 'Cancelling…'); try { await api('/api/subscriptions/demo-cancel', { method: 'POST', body: '{}' }); location.reload(); } catch (error) { accountError(error.message); setBusy(event.currentTarget, false); } }
async function deleteAssessment(event) { const id = event.currentTarget.dataset.deleteAssessment; if (!confirm('Permanently delete this assessment and its evidence?')) return; setBusy(event.currentTarget, true, 'Deleting…'); try { await api(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }); location.reload(); } catch (error) { accountError(error.message); setBusy(event.currentTarget, false); } }
async function setupMfa(event) { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); setBusy(button, true, 'Preparing…'); try { const data = await api('/api/account/mfa/setup', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#mfaSetupPassword').value }) }); pendingMfaSecret = data.secret; document.querySelector('#mfaSecret').value = data.secret; document.querySelector('#mfaSetupDetails').hidden = false; accountMessage('Add this secret to your authenticator. It is shown only during setup.'); } catch (error) { accountError(error.message); } finally { setBusy(button, false); } }
async function enableMfa(event) { setBusy(event.currentTarget, true, 'Enabling…'); try { const data = await api('/api/account/mfa/enable', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#mfaSetupPassword').value, secret: pendingMfaSecret, code: document.querySelector('#mfaEnableCode').value }) }); document.querySelector('#mfaSetupDetails').innerHTML = `<div class="success-box"><strong>Save these recovery codes now.</strong><pre>${escapeHtml(data.recoveryCodes.join('\n'))}</pre><p>Each code works once. Store them in a password manager.</p></div>`; accountMessage('MFA enabled. Other sessions were closed. Sign in again after saving the codes.'); } catch (error) { accountError(error.message); setBusy(event.currentTarget, false); } }
async function disableMfa(event) { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Disabling…'); try { await api('/api/account/mfa/disable', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#mfaDisablePassword').value, code: document.querySelector('#mfaDisableCode').value }) }); location.href = '/auth.html'; } catch (error) { accountError(error.message); setBusy(button, false); } }
async function updatePassword(event) { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Updating…'); try { await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: document.querySelector('#currentPassword').value, newPassword: document.querySelector('#newPassword').value }) }); event.currentTarget.reset(); accountMessage('Password updated. Other signed-in sessions were closed.'); } catch (error) { accountError(error.message); } finally { setBusy(button, false); } }
async function deleteAccount(event) { event.preventDefault(); if (!confirm('This permanently deletes the account and cannot be undone. Continue?')) return; const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Deleting…'); try { await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#deletePassword').value, code: document.querySelector('#deleteMfaCode')?.value || '', confirmation: document.querySelector('#deleteConfirmation').value }) }); location.href = '/?accountDeleted=1'; } catch (error) { accountError(error.message); setBusy(button, false); } }
function accountMessage(message) { const box = document.querySelector('#accountMessage'); if (!box) return; box.textContent = message; box.hidden = false; document.querySelector('#accountError')?.classList.remove('show'); }
function accountError(message) { const box = document.querySelector('#accountError'); if (box) showError(box, message); }

document.querySelector('#logout')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = '/'; });
init();