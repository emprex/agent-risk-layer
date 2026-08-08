import { api, escapeHtml, money, riskClass, setBusy, showError } from './shared.js';

const root = document.querySelector('#dashboardRoot');
let dashboardData;
let pendingMfaSecret = '';

async function init() {
  try {
    dashboardData = await api('/api/dashboard');
    const data = dashboardData;
    document.querySelector('#welcome').textContent = `Welcome back, ${data.user.email.split('@')[0]}.`;
    root.className = '';
    root.innerHTML = `
      ${verificationBanner(data.user)}
      ${data.user.isSuperuser ? '<div class="notice"><strong>Owner access is active.</strong> Advanced reports and owner operations are available. Production owner actions still require MFA. <a class="text-link" href="/admin.html">Open owner operations</a></div>' : ''}
      ${todayActions(data)}
      ${progressOverview(data)}
      <section id="risks" class="panel section-gap">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Your agents</span><h2>Checks and next actions</h2><p>Open a result to see what information, evidence or remediation is needed next.</p></div><a class="button primary small" href="/assessment.html">Check another agent</a></div>
        <div class="assessment-list">${data.assessments.length ? data.assessments.map(assessmentHtml).join('') : emptyAssessments()}</div>
      </section>
      ${advancedTools(data)}
      <div class="dashboard-grid section-gap">
        <section class="panel">
          <div class="section-heading compact-heading"><div><span class="eyebrow">Plan</span><h2>Plan and billing</h2></div><a class="button ghost small" href="/pricing.html">Compare plans</a></div>
          ${subscriptionHtml(data.subscription)}
        </section>
        <section class="panel">
          <h2>Payment and report delivery</h2>
          ${data.purchases.length ? data.purchases.slice(0, 12).map(purchaseHtml).join('') : '<p class="muted">No payments yet.</p>'}
        </section>
      </div>
      <section id="settings" class="panel section-gap account-settings">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Account security</span><h2>Privacy and account settings</h2></div><a class="button ghost small" href="/api/account/export">Download my data</a></div>
        <div id="accountMessage" class="success-box" hidden></div><div id="accountError" class="error-box"></div>
        <div class="settings-grid">
          ${mfaHtml(data.user)}
          <form id="passwordForm" class="auth-form settings-card"><h3>Change password</h3><div class="field"><label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="newPassword">New password</label><input id="newPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div><button class="button ghost" type="submit">Update password</button></form>
          <form id="deleteAccountForm" class="auth-form settings-card danger-zone"><h3>Delete account</h3><p class="muted small-copy">Permanently removes account data. Active subscriptions must be cancelled first.</p><div class="field"><label for="deletePassword">Password</label><input id="deletePassword" type="password" autocomplete="current-password" required></div>${data.user.mfaEnabled ? '<div class="field"><label for="deleteMfaCode">Authenticator or recovery code</label><input id="deleteMfaCode" type="text" autocomplete="one-time-code" required></div>' : ''}<div class="field"><label for="deleteConfirmation">Type DELETE</label><input id="deleteConfirmation" type="text" required autocomplete="off"></div><button class="button danger" type="submit">Delete account permanently</button></form>
        </div>
      </section>`;
    wireEvents();
    const registrationNotice = sessionStorage.getItem('arl_registration_notice');
    if (registrationNotice) { accountMessage(registrationNotice); sessionStorage.removeItem('arl_registration_notice'); }
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

function todayActions(data) {
  const assessments = data.assessments || [];
  const projects = data.controlPlane?.projects || [];
  const openFixes = Number(data.controlPlane?.totals?.openRemediations || 0);
  const incomplete = assessments.filter(isIncompleteAssessment);
  const scoreable = assessments.filter((item) => !isIncompleteAssessment(item));
  const highest = [...scoreable].sort((a, b) => Number(b.score) - Number(a.score))[0];
  const reviewTarget = incomplete[0] || highest || assessments[0];
  const critical = scoreable.filter((item) => String(item.risk_band || item.riskBand || '').toLowerCase() === 'critical').length;
  let recommended;
  if (!assessments.length) recommended = { eyebrow: 'Recommended first step', title: 'Check one AI agent', text: 'Answer simple questions about access, data, actions and recovery. You will receive a clear decision and the first risks to address.', href: '/assessment.html', action: 'Start the free check', time: 'About 5–10 minutes' };
  else if (critical || (highest && Number(highest.score) >= 75)) recommended = { eyebrow: 'Urgent review', title: `Review ${highest.name}`, text: 'This is currently your highest recorded declared risk. Read the decision first, then assign the most important confirmed fix.', href: assessmentLink(highest), action: 'Review the result', time: 'Start with the first confirmed finding' };
  else if (incomplete.length) recommended = { eyebrow: 'Information required', title: `Complete ${incomplete[0].name}`, text: 'This check is on hold because material security information is still unanswered. Open the result, confirm the missing context with the agent owner, then create an updated assessment with the clarified answers.', href: assessmentLink(incomplete[0]), action: 'Review missing information', time: 'Unknowns are not vulnerabilities' };
  else if (openFixes) recommended = { eyebrow: 'Work in progress', title: `Close ${openFixes} open ${openFixes === 1 ? 'fix' : 'fixes'}`, text: 'Confirm the owner, attach implementation evidence and retest the same risk before marking it closed.', href: '/control-plane.html#remediation', action: 'Open required fixes', time: 'Evidence required before closure' };
  else if (!projects.length) recommended = { eyebrow: 'Next protection step', title: 'See live protection work', text: 'Run the safe built-in example before connecting code. It shows missing, changed and reused approvals being blocked.', href: '/control-plane.html', action: 'Run the safe example', time: 'About 30 seconds' };
  else recommended = { eyebrow: 'Keep control current', title: 'Review your latest agent decisions', text: 'Check what the runtime policy allowed or blocked and whether any new access or behaviour needs attention.', href: '/control-plane.html', action: 'Review live protection', time: 'No terminal required' };

  return `<section class="v10-dashboard-next" aria-labelledby="todayActionsTitle">
    <article class="dashboard-recommended-action"><div><span class="eyebrow">${escapeHtml(recommended.eyebrow)}</span><h2 id="todayActionsTitle">${escapeHtml(recommended.title)}</h2><p>${escapeHtml(recommended.text)}</p><small>${escapeHtml(recommended.time)}</small></div><a class="button primary button-xl" href="${recommended.href}">${escapeHtml(recommended.action)} →</a></article>
    <div class="dashboard-secondary-actions" aria-label="Other security tasks">
      <a href="/assessment.html"><span>Check</span><strong>Assess another agent</strong><small>Understand risk and the next action</small></a>
      <a href="${reviewTarget ? assessmentLink(reviewTarget) : '/sample-report.html'}"><span>Review</span><strong>${reviewTarget ? 'Open the latest result' : 'See an example result'}</strong><small>Information, findings, decision and proof</small></a>
      <a href="/control-plane.html"><span>Protect</span><strong>Open live protection</strong><small>Safe example, policies and decisions</small></a>
    </div>
  </section>`;
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
    ? { label: 'Complete missing information', complete: false, detail: `${incompleteCount} incomplete ${incompleteCount === 1 ? 'check needs' : 'checks need'} clarification`, href: '#risks' }
    : { label: 'Address urgent findings', complete: assessed && urgent === 0, detail: urgent ? `${urgent} critical ${urgent === 1 ? 'result needs' : 'results need'} attention` : assessed ? 'No critical result recorded' : 'Complete a check first', href: '#risks' };
  const steps = [
    { label: 'Check the risk', complete: assessed, detail: assessed ? `${Number(data.stats.assessments || 0)} saved ${Number(data.stats.assessments || 0) === 1 ? 'check' : 'checks'}` : 'No agent checked yet', href: '/assessment.html' },
    reviewStep,
    { label: 'Track and verify fixes', complete: assessed && incompleteCount === 0 && openFixes === 0, detail: incompleteCount ? 'Clarify the missing security information before creating fixes' : openFixes ? `${openFixes} open ${openFixes === 1 ? 'fix' : 'fixes'}` : assessed ? 'No open fix recorded' : 'No work recorded yet', href: '/control-plane.html#remediation' },
    { label: 'Protect live actions', complete: protectedRequests > 0, detail: protectedRequests ? `${protectedRequests.toLocaleString('en-GB')} decisions this month` : 'No live decision recorded yet', href: '/control-plane.html' },
  ];
  const complete = steps.filter((step) => step.complete).length;
  return `<section class="v10-progress-panel"><div class="progress-panel-heading"><div><span class="eyebrow">Your progress</span><h2>${complete} of ${steps.length} security steps active</h2><p>This is a guide, not an automatic deployment approval.</p></div><strong>${Math.round((complete / steps.length) * 100)}%</strong></div><ol class="v10-task-list">${steps.map((step, index) => `<li class="${step.complete ? 'complete' : ''}"><a href="${step.href}"><span>${step.complete ? '✓' : index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div><b>${step.complete ? 'Active' : 'Next'}</b></a></li>`).join('')}</ol></section>`;
}

function emptyAssessments() {
  return '<div class="empty-state customer-empty"><h3>No agents checked yet</h3><p>Start with one agent. The result will explain the main risks and what to do next.</p><a class="button primary" href="/assessment.html">Check my first agent</a></div>';
}

function advancedTools(data) {
  const totals = data.controlPlane?.totals || {};
  const projects = data.controlPlane?.projects || [];
  const entitlement = data.controlPlane?.entitlement || { name: 'Community', runtimeRequestsPerMonth: 10000, retentionDays: 7 };
  const readinessLinks = projects.slice(0, 5).map((project) => `<a href="/risk-readiness.html?projectId=${encodeURIComponent(project.id)}"><strong>${escapeHtml(project.name)} evidence readiness</strong><span>Applicability, evidence states and deployment gates</span></a>`).join('');
  return `<details class="panel section-gap advanced-tools">
    <summary><span><strong>Technical tools</strong><small>Inspector, attack simulation, runtime policies, API keys, inventory and audit evidence</small></span><span>Open advanced tools</span></summary>
    <div class="advanced-tools-body">
      <p>These tools are for developers, security teams and auditors. You do not need them to understand your first result.</p>
      <div class="technical-tool-grid">
        <a href="/control-intelligence.html"><strong>Control Intelligence</strong><span>Architecture, controls, evidence chain and deployment decision</span></a>
        <a href="/control-plane.html"><strong>Live protection</strong><span>Policies, keys and runtime decisions</span></a>
        <a href="/inspector.html"><strong>Code and configuration check</strong><span>Local, read-only technical evidence</span></a>
        <a href="/redteam.html"><strong>Attack simulation</strong><span>Controlled tests for authorised systems</span></a>
        <a href="/workspaces.html"><strong>Team access</strong><span>Roles, workspaces and integrations</span></a>
        <a href="/risk-library.html"><strong>Risk library</strong><span>Problem, bounded check and remediation guidance</span></a>
        ${readinessLinks}
      </div>
      <div class="technical-usage-line"><span>${escapeHtml(entitlement.name)} plan</span><span>${Number(totals.projects || 0)} projects</span><span>${Number(totals.assets || 0)} assets tracked</span><span>${entitlement.retentionDays || 7}-day retention</span></div>
    </div>
  </details>`;
}

function verificationBanner(user) {
  if (user.emailVerified) return '';
  return `<section class="notice verification-banner"><div><strong>Verify your email to use paid and technical workflows</strong><p>Your saved checks remain available. Verification protects report purchases, local inspection and attack-test authorisations.</p></div><button id="resendVerification" class="button ghost small">Resend verification email</button></section>`;
}

function mfaHtml(user) {
  if (user.mfaEnabled) return `<form id="mfaDisableForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="pass-text">Enabled</p><p class="muted small-copy">A TOTP authenticator or unused recovery code is required at sign-in.</p><div class="field"><label for="mfaDisablePassword">Password</label><input id="mfaDisablePassword" type="password" required autocomplete="current-password"></div><div class="field"><label for="mfaDisableCode">Authenticator or recovery code</label><input id="mfaDisableCode" type="text" required autocomplete="one-time-code"></div><button class="button danger" type="submit">Disable MFA</button></form>`;
  if (!user.emailVerified) return `<section class="settings-card"><h3>Multi-factor authentication</h3><p class="muted">Verify your email before enabling MFA.</p></section>`;
  return `<form id="mfaSetupForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="muted small-copy">Protect your account with any TOTP authenticator app.</p><div class="field"><label for="mfaSetupPassword">Password</label><input id="mfaSetupPassword" type="password" required autocomplete="current-password"></div><button class="button ghost" type="submit">Start MFA setup</button><div id="mfaSetupDetails" hidden><div class="field"><label for="mfaSecret">Manual setup secret</label><input id="mfaSecret" readonly></div><p class="muted small-copy">Add the secret to your authenticator, then enter the six-digit code.</p><div class="field"><label for="mfaEnableCode">Authentication code</label><input id="mfaEnableCode" type="text" inputmode="numeric" autocomplete="one-time-code"></div><button id="enableMfaButton" class="button primary" type="button">Enable MFA</button></div></form>`;
}

function purchaseHtml(purchase) {
  const fulfilment = purchase.fulfilment_state === 'fulfilled' ? 'Access granted' : `Fulfilment ${purchase.fulfilment_state}`;
  const email = purchase.email_state === 'sent' || purchase.email_state === 'simulated' ? 'Email delivered' : purchase.email_state === 'dead' ? 'Email needs support' : `Email ${purchase.email_state}`;
  const problem = purchase.fulfilment_error || purchase.email_error;
  return `<div class="assessment-row"><div><strong>${escapeHtml(purchase.product_key.replaceAll('_', ' '))}</strong><div class="assessment-meta"><span>${new Date(purchase.created_at).toLocaleDateString('en-GB')}</span><span>${escapeHtml(fulfilment)}</span><span>${escapeHtml(email)}</span></div>${problem ? `<p class="fail-text small-copy">${escapeHtml(problem)}</p>` : ''}</div><span>${money(purchase.amount_pence, false, purchase.currency)}</span></div>`;
}

function assessmentHtml(assessment) {
  const incomplete = isIncompleteAssessment(assessment);
  const urgent = assessment.risk_band === 'Critical' || assessment.risk_band === 'High';
  const next = incomplete
    ? 'Complete missing security information before a deployment decision'
    : urgent
      ? 'Fix the highest confirmed risks before wider use'
      : assessment.latest_inspection_summary
        ? 'Review the latest evidence and check again after changes'
        : 'Add proof or a technical check when you need stronger assurance';
  const status = incomplete
    ? '<span class="risk-pill">Security information incomplete</span><strong>—</strong>'
    : `<span class="risk-pill ${riskClass(assessment.risk_band)}">${escapeHtml(assessment.risk_band)} declared risk</span><strong>${assessment.score}/100</strong>`;
  return `<article class="customer-assessment-row">
    <div class="assessment-status-block">${status}</div>
    <div class="assessment-main"><h3>${escapeHtml(assessment.name)}</h3><p>${escapeHtml(assessment.agent_type)} · checked ${new Date(assessment.created_at).toLocaleDateString('en-GB')}</p><div class="assessment-next"><small>Next action</small><strong>${escapeHtml(next)}</strong></div></div>
    <div class="assessment-simple-actions"><a class="button primary small" href="${assessmentLink(assessment)}">Open result</a><button class="icon-button" title="Delete assessment" aria-label="Delete ${escapeHtml(assessment.name)}" data-delete-assessment="${escapeHtml(assessment.id)}">×</button></div>
  </article>`;
}

function subscriptionHtml(subscription) {
  if (dashboardData?.user?.isSuperuser) return `<div class="subscription-card"><strong>Owner access</strong><p class="muted">Reports and technical tools are enabled for the owner account. Production owner operations still require MFA.</p><a class="button ghost full" href="/admin.html">Owner operations</a></div>`;
  if (!subscription) return `<div class="subscription-card"><strong>Community · £0</strong><p class="muted">One security project, 10,000 runtime checks each month and seven-day event retention.</p><a class="button ghost full" href="/pricing.html">Compare plans</a></div>`;
  return `<div class="subscription-card"><strong>${escapeHtml(subscription.plan_key.replaceAll('_', ' '))}</strong><p class="muted">Status: ${escapeHtml(subscription.status)}${subscription.current_period_end ? `<br>Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB')}` : ''}</p><button class="button ghost full" id="billingPortal">Manage billing</button>${subscription.stripe_subscription_id?.startsWith('demo_') && subscription.status === 'active' ? '<button class="button danger full" id="cancelDemo">Cancel demo plan</button>' : ''}</div>`;
}

function wireEvents() {
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

document.querySelector('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = '/'; });
init();
