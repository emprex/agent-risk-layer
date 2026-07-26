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
      ${data.user.isSuperuser ? '<div class="notice"><strong>Superuser access active.</strong> Professional reports, Inspector, Red Team and owner operations are unlocked. Production owner operations still require MFA. <a class="text-link" href="/admin.html">Open owner operations</a></div>' : ''}
      <div class="dashboard-stats">
        <div class="stat"><span>Assessments</span><strong>${data.stats.assessments}</strong></div>
        <div class="stat"><span>Average risk</span><strong>${data.stats.averageScore}</strong></div>
        <div class="stat"><span>Critical</span><strong>${data.stats.critical}</strong></div>
        <div class="stat"><span>Paid reports</span><strong>${data.stats.paidReports}</strong></div>
        <div class="stat"><span>Technical inspections</span><strong>${data.stats.inspections}</strong></div>
        <div class="stat"><span>Red-team runs</span><strong>${data.stats.redTeamRuns}</strong></div>
        <div class="stat"><span>Security projects</span><strong>${data.controlPlane?.totals?.projects || 0}</strong></div>
        <div class="stat"><span>Runtime checks</span><strong>${data.controlPlane?.totals?.runtimeRequestsMonth || 0}</strong><small>This month</small></div>
      </div>
      ${controlPlaneCard(data.controlPlane)}
      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-heading compact-heading"><h2>Assessment history</h2><a class="button primary small" href="/assessment.html">New assessment</a></div>
          <div class="assessment-list">${data.assessments.length ? data.assessments.map(assessmentHtml).join('') : '<div class="empty-state">No saved assessments yet.<br><br><a class="button primary" href="/assessment.html">Assess your first agent</a></div>'}</div>
        </section>
        <aside class="panel">
          <h2>Plan and billing</h2>${subscriptionHtml(data.subscription)}
          <h3 class="section-gap">Payment and delivery history</h3>
          ${data.purchases.length ? data.purchases.slice(0, 12).map(purchaseHtml).join('') : '<p class="muted">No payments yet.</p>'}
        </aside>
      </div>
      <section class="panel section-gap account-settings">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Privacy and security</span><h2>Account settings</h2></div><a class="button ghost small" href="/api/account/export">Download my data</a></div>
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

function controlPlaneCard(controlPlane) {
  const totals = controlPlane?.totals || {};
  const entitlement = controlPlane?.entitlement || { name: 'Community', runtimeRequestsPerMonth: 10000 };
  const projects = controlPlane?.projects || [];
  const usage = Number(totals.runtimeRequestsMonth || 0);
  const limit = Number(entitlement.runtimeRequestsPerMonth || 10000);
  return `<section class="panel section-gap control-dashboard-card"><div class="section-heading compact-heading"><div><span class="eyebrow">Runtime control plane</span><h2>${projects.length ? 'Your live security projects' : 'Protect your first runtime boundary'}</h2><p>${escapeHtml(entitlement.name)} plan · ${usage.toLocaleString('en-GB')} of ${limit.toLocaleString('en-GB')} Guard decisions used this month.</p></div><a class="button primary" href="/control-plane.html">${projects.length ? 'Open control plane' : 'Create free project'}</a></div><div class="dashboard-stats"><div class="stat"><span>Denied this month</span><strong>${Number(totals.deniedMonth || 0).toLocaleString('en-GB')}</strong></div><div class="stat"><span>Assets tracked</span><strong>${Number(totals.assets || 0).toLocaleString('en-GB')}</strong></div><div class="stat"><span>Open remediation</span><strong>${Number(totals.openRemediations || 0).toLocaleString('en-GB')}</strong></div><div class="stat"><span>Retention</span><strong>${entitlement.retentionDays || 7} days</strong></div></div></section>`;
}

function verificationBanner(user) {
  if (user.emailVerified) return '';
  return `<section class="notice verification-banner"><div><strong>Email verification required</strong><p>Verify your email before purchasing reports or running inspection and red-team workflows.</p></div><button id="resendVerification" class="button ghost small">Resend verification email</button></section>`;
}

function mfaHtml(user) {
  if (user.mfaEnabled) return `<form id="mfaDisableForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="pass-text">Enabled</p><p class="muted small-copy">A TOTP authenticator or unused recovery code is required at sign-in.</p><div class="field"><label for="mfaDisablePassword">Password</label><input id="mfaDisablePassword" type="password" required autocomplete="current-password"></div><div class="field"><label for="mfaDisableCode">Authenticator or recovery code</label><input id="mfaDisableCode" type="text" required autocomplete="one-time-code"></div><button class="button danger" type="submit">Disable MFA</button></form>`;
  if (!user.emailVerified) return `<section class="settings-card"><h3>Multi-factor authentication</h3><p class="muted">Verify your email before enabling MFA.</p></section>`;
  return `<form id="mfaSetupForm" class="auth-form settings-card"><h3>Multi-factor authentication</h3><p class="muted small-copy">Protect your account with any TOTP authenticator app.</p><div class="field"><label for="mfaSetupPassword">Password</label><input id="mfaSetupPassword" type="password" required autocomplete="current-password"></div><button class="button ghost" type="submit">Start MFA setup</button><div id="mfaSetupDetails" hidden><div class="field"><label for="mfaSecret">Manual setup secret</label><input id="mfaSecret" readonly></div><p class="muted small-copy">Add the secret to your authenticator, then enter the six-digit code.</p><div class="field"><label for="mfaEnableCode">Authentication code</label><input id="mfaEnableCode" type="text" inputmode="numeric" autocomplete="one-time-code"></div><button id="enableMfaButton" class="button primary" type="button">Enable MFA</button></div></form>`;
}

function purchaseHtml(p) {
  const fulfilment = p.fulfilment_state === 'fulfilled' ? 'Access granted' : `Fulfilment ${p.fulfilment_state}`;
  const email = p.email_state === 'sent' || p.email_state === 'simulated' ? 'Email delivered' : p.email_state === 'dead' ? 'Email needs support' : `Email ${p.email_state}`;
  const problem = p.fulfilment_error || p.email_error;
  return `<div class="assessment-row"><div><strong>${escapeHtml(p.product_key.replaceAll('_',' '))}</strong><div class="assessment-meta"><span>${new Date(p.created_at).toLocaleDateString('en-GB')}</span><span>${escapeHtml(fulfilment)}</span><span>${escapeHtml(email)}</span></div>${problem ? `<p class="fail-text small-copy">${escapeHtml(problem)}</p>` : ''}</div><span>${money(p.amount_pence, false, p.currency)}</span></div>`;
}

function assessmentHtml(a) {
  return `<div class="assessment-row"><div><h4>${escapeHtml(a.name)}</h4><div class="assessment-meta"><span>${escapeHtml(a.agent_type)}</span><span>${new Date(a.created_at).toLocaleDateString('en-GB')}</span><span class="risk-pill ${riskClass(a.risk_band)} mini-pill">${escapeHtml(a.risk_band)}</span><span>${a.paid_tier === 'free' ? 'Free summary' : `${escapeHtml(a.paid_tier)} report`}</span><span>${a.latest_inspection_summary ? `Inspected ${a.latest_inspection_summary.postureScore}/100` : 'Self-assessment only'}</span><span>${a.latest_redteam_summary ? `Red-team assurance ${a.latest_redteam_summary.assuranceScore}/100` : 'No red-team evidence'}</span><span>${a.public_enabled ? 'Public sharing on' : 'Private'}</span></div></div><div class="row-actions"><div class="score-badge">${a.score}/100</div><a class="button ghost small" href="/result.html?id=${encodeURIComponent(a.id)}&token=${encodeURIComponent(a.access_token)}">Open</a><a class="button ghost small" href="/inspector.html?assessment=${encodeURIComponent(a.id)}">Inspect</a><a class="button ghost small" href="/redteam.html?assessment=${encodeURIComponent(a.id)}">Red team</a><button class="icon-button" title="Delete assessment" aria-label="Delete ${escapeHtml(a.name)}" data-delete-assessment="${escapeHtml(a.id)}">×</button></div></div>`;
}

function subscriptionHtml(subscription) {
  if (dashboardData?.user?.isSuperuser) return `<div class="subscription-card"><strong>Superuser</strong><p class="muted">All AgentRiskLayer services are enabled for the owner account without checkout.</p><a class="button ghost full" href="/admin.html">Owner operations</a></div>`;
  if (!subscription) return `<div class="subscription-card"><strong>No active plan</strong><p class="muted">Buy a report or subscribe for repeat assurance.</p><a class="button ghost full" href="/pricing.html">View plans</a></div>`;
  return `<div class="subscription-card"><strong>${escapeHtml(subscription.plan_key.replaceAll('_',' '))}</strong><p class="muted">Status: ${escapeHtml(subscription.status)}${subscription.current_period_end ? `<br>Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB')}` : ''}</p><button class="button ghost full" id="billingPortal">Manage billing</button>${subscription.stripe_subscription_id?.startsWith('demo_') && subscription.status === 'active' ? '<button class="button danger full" id="cancelDemo">Cancel demo plan</button>' : ''}</div>`;
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

async function resendVerification(event) { setBusy(event.currentTarget,true,'Sending…'); try { await api('/api/auth/verification/resend',{method:'POST',body:'{}'}); accountMessage('Verification email sent.'); } catch(error){ accountError(error.message); } finally { setBusy(event.currentTarget,false); } }
async function billingPortal(event) { setBusy(event.currentTarget,true,'Opening…'); try { const {url}=await api('/api/billing/portal',{method:'POST',body:'{}'}); location.href=url; } catch(error){ accountError(error.message); setBusy(event.currentTarget,false); } }
async function cancelDemo(event) { if(!confirm('Cancel the demo subscription?'))return; setBusy(event.currentTarget,true,'Cancelling…'); try{await api('/api/subscriptions/demo-cancel',{method:'POST',body:'{}'});location.reload();}catch(error){accountError(error.message);setBusy(event.currentTarget,false);} }
async function deleteAssessment(event) { const id=event.currentTarget.dataset.deleteAssessment;if(!confirm('Permanently delete this assessment and its evidence?'))return;setBusy(event.currentTarget,true,'Deleting…');try{await api(`/api/assessments/${encodeURIComponent(id)}`,{method:'DELETE'});location.reload();}catch(error){accountError(error.message);setBusy(event.currentTarget,false);} }

async function setupMfa(event) { event.preventDefault(); const button=event.currentTarget.querySelector('button[type="submit"]');setBusy(button,true,'Preparing…');try{const data=await api('/api/account/mfa/setup',{method:'POST',body:JSON.stringify({password:document.querySelector('#mfaSetupPassword').value})});pendingMfaSecret=data.secret;document.querySelector('#mfaSecret').value=data.secret;document.querySelector('#mfaSetupDetails').hidden=false;accountMessage('Add this secret to your authenticator. It is shown only during setup.');}catch(error){accountError(error.message);}finally{setBusy(button,false);} }
async function enableMfa(event) { setBusy(event.currentTarget,true,'Enabling…');try{const data=await api('/api/account/mfa/enable',{method:'POST',body:JSON.stringify({password:document.querySelector('#mfaSetupPassword').value,secret:pendingMfaSecret,code:document.querySelector('#mfaEnableCode').value})});document.querySelector('#mfaSetupDetails').innerHTML=`<div class="success-box"><strong>Save these recovery codes now.</strong><pre>${escapeHtml(data.recoveryCodes.join('\n'))}</pre><p>Each code works once. Store them in a password manager.</p></div>`;accountMessage('MFA enabled. Other sessions were closed. Sign in again after saving the codes.');}catch(error){accountError(error.message);setBusy(event.currentTarget,false);} }
async function disableMfa(event) { event.preventDefault();const button=event.currentTarget.querySelector('button');setBusy(button,true,'Disabling…');try{await api('/api/account/mfa/disable',{method:'POST',body:JSON.stringify({password:document.querySelector('#mfaDisablePassword').value,code:document.querySelector('#mfaDisableCode').value})});location.href='/auth.html';}catch(error){accountError(error.message);setBusy(button,false);} }
async function updatePassword(event) { event.preventDefault();const button=event.currentTarget.querySelector('button');setBusy(button,true,'Updating…');try{await api('/api/account/password',{method:'POST',body:JSON.stringify({currentPassword:document.querySelector('#currentPassword').value,newPassword:document.querySelector('#newPassword').value})});event.currentTarget.reset();accountMessage('Password updated. Other signed-in sessions were closed.');}catch(error){accountError(error.message);}finally{setBusy(button,false);} }
async function deleteAccount(event) { event.preventDefault();if(!confirm('This permanently deletes the account and cannot be undone. Continue?'))return;const button=event.currentTarget.querySelector('button');setBusy(button,true,'Deleting…');try{await api('/api/account/delete',{method:'POST',body:JSON.stringify({password:document.querySelector('#deletePassword').value,code:document.querySelector('#deleteMfaCode')?.value||'',confirmation:document.querySelector('#deleteConfirmation').value})});location.href='/?accountDeleted=1';}catch(error){accountError(error.message);setBusy(button,false);} }
function accountMessage(message){const box=document.querySelector('#accountMessage');if(!box)return;box.textContent=message;box.hidden=false;document.querySelector('#accountError')?.classList.remove('show');}
function accountError(message){const box=document.querySelector('#accountError');if(box)showError(box,message);}

document.querySelector('#logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});location.href='/';});
init();
