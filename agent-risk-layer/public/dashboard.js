import { api, escapeHtml, money, riskClass, setBusy, showError } from './shared.js';
const root = document.querySelector('#dashboardRoot');

async function init() {
  try {
    const data = await api('/api/dashboard');
    document.querySelector('#welcome').textContent = `Welcome back, ${data.user.email.split('@')[0]}.`;
    root.className = '';
    root.innerHTML = `
      <div class="dashboard-stats">
        <div class="stat"><span>Assessments</span><strong>${data.stats.assessments}</strong></div>
        <div class="stat"><span>Average risk</span><strong>${data.stats.averageScore}</strong></div>
        <div class="stat"><span>Critical</span><strong>${data.stats.critical}</strong></div>
        <div class="stat"><span>Paid reports</span><strong>${data.stats.paidReports}</strong></div>
      </div>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-heading compact-heading"><h2>Assessment history</h2><a class="button primary small" href="/assessment.html">New assessment</a></div>
          <div class="assessment-list">${data.assessments.length ? data.assessments.map(assessmentHtml).join('') : '<div class="empty-state">No saved assessments yet.<br><br><a class="button primary" href="/assessment.html">Assess your first agent</a></div>'}</div>
        </section>
        <aside class="panel">
          <h2>Plan and billing</h2>
          ${subscriptionHtml(data.subscription)}
          <h3 class="section-gap">Payment history</h3>
          ${data.purchases.length ? data.purchases.slice(0, 8).map((p) => `<div class="assessment-row"><div><strong>${escapeHtml(p.product_key.replaceAll('_',' '))}</strong><div class="assessment-meta"><span>${new Date(p.created_at).toLocaleDateString('en-GB')}</span><span>${escapeHtml(p.status)}</span></div></div><span>${money(p.amount_pence, false, p.currency)}</span></div>`).join('') : '<p class="muted">No payments yet.</p>'}
        </aside>
      </div>
      <section class="panel section-gap account-settings">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Privacy and security</span><h2>Account settings</h2></div><a class="button ghost small" href="/api/account/export">Download my data</a></div>
        <div id="accountMessage" class="success-box" hidden></div>
        <div id="accountError" class="error-box"></div>
        <div class="settings-grid">
          <form id="passwordForm" class="auth-form settings-card">
            <h3>Change password</h3>
            <div class="field"><label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="newPassword">New password</label><input id="newPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div>
            <button class="button ghost" type="submit">Update password</button>
          </form>
          <form id="deleteAccountForm" class="auth-form settings-card danger-zone">
            <h3>Delete account</h3>
            <p class="muted small-copy">Permanently removes your assessments, reports, purchase history and account data. Active subscriptions must be cancelled first.</p>
            <div class="field"><label for="deletePassword">Password</label><input id="deletePassword" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="deleteConfirmation">Type DELETE</label><input id="deleteConfirmation" type="text" required autocomplete="off"></div>
            <button class="button danger" type="submit">Delete account permanently</button>
          </form>
        </div>
      </section>`;

    document.querySelector('#billingPortal')?.addEventListener('click', billingPortal);
    document.querySelector('#cancelDemo')?.addEventListener('click', cancelDemo);
    document.querySelectorAll('[data-delete-assessment]').forEach((button) => button.addEventListener('click', deleteAssessment));
    document.querySelector('#passwordForm').addEventListener('submit', updatePassword);
    document.querySelector('#deleteAccountForm').addEventListener('submit', deleteAccount);
  } catch (error) {
    if (error.message.includes('Sign in')) location.href = `/auth.html?next=${encodeURIComponent('/dashboard.html')}`;
    else root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

function assessmentHtml(a) {
  return `<div class="assessment-row">
    <div><h4>${escapeHtml(a.name)}</h4><div class="assessment-meta"><span>${escapeHtml(a.agent_type)}</span><span>${new Date(a.created_at).toLocaleDateString('en-GB')}</span><span class="risk-pill ${riskClass(a.risk_band)} mini-pill">${escapeHtml(a.risk_band)}</span><span>${a.paid_tier === 'free' ? 'Free summary' : `${escapeHtml(a.paid_tier)} report`}</span><span>${a.public_enabled ? 'Public sharing on' : 'Private'}</span></div></div>
    <div class="row-actions"><div class="score-badge">${a.score}/100</div><a class="button ghost small" href="/result.html?id=${encodeURIComponent(a.id)}&token=${encodeURIComponent(a.access_token)}">Open</a><button class="icon-button" title="Delete assessment" aria-label="Delete ${escapeHtml(a.name)}" data-delete-assessment="${escapeHtml(a.id)}">×</button></div>
  </div>`;
}

function subscriptionHtml(subscription) {
  if (!subscription) return `<div class="subscription-card"><strong>No active plan</strong><p class="muted">Buy one-off reports or subscribe for repeat professional assessments.</p><a class="button ghost full" href="/pricing.html">View plans</a></div>`;
  return `<div class="subscription-card"><strong>${escapeHtml(subscription.plan_key.replaceAll('_',' '))}</strong><p class="muted">Status: ${escapeHtml(subscription.status)}${subscription.current_period_end ? `<br>Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB')}` : ''}</p><button class="button ghost full" id="billingPortal">Manage billing</button>${subscription.stripe_subscription_id?.startsWith('demo_') && subscription.status === 'active' ? '<button class="button danger full" id="cancelDemo">Cancel demo plan</button>' : ''}</div>`;
}

async function billingPortal(event) {
  setBusy(event.currentTarget, true, 'Opening…');
  try { const { url } = await api('/api/billing/portal', { method: 'POST', body: '{}' }); location.href = url; }
  catch (error) { alert(error.message); setBusy(event.currentTarget, false); }
}

async function cancelDemo(event) {
  if (!confirm('Cancel the demo subscription?')) return;
  setBusy(event.currentTarget, true, 'Cancelling…');
  try { await api('/api/subscriptions/demo-cancel', { method: 'POST', body: '{}' }); location.reload(); }
  catch (error) { alert(error.message); setBusy(event.currentTarget, false); }
}

async function deleteAssessment(event) {
  const id = event.currentTarget.dataset.deleteAssessment;
  if (!confirm('Permanently delete this assessment? Purchased report access for it will also be removed.')) return;
  setBusy(event.currentTarget, true, '…');
  try { await api(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }); location.reload(); }
  catch (error) { alert(error.message); setBusy(event.currentTarget, false); }
}

async function updatePassword(event) {
  event.preventDefault();
  const errorBox = document.querySelector('#accountError');
  const message = document.querySelector('#accountMessage');
  errorBox.classList.remove('show'); message.hidden = true;
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Updating…');
  try {
    await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: document.querySelector('#currentPassword').value, newPassword: document.querySelector('#newPassword').value }) });
    event.currentTarget.reset();
    message.textContent = 'Password updated. Other signed-in sessions were closed.';
    message.hidden = false;
  } catch (error) { showError(errorBox, error.message); }
  setBusy(button, false);
}

async function deleteAccount(event) {
  event.preventDefault();
  const errorBox = document.querySelector('#accountError');
  errorBox.classList.remove('show');
  if (!confirm('This permanently deletes the account and cannot be undone. Continue?')) return;
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Deleting…');
  try {
    await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#deletePassword').value, confirmation: document.querySelector('#deleteConfirmation').value }) });
    location.href = '/?accountDeleted=1';
  } catch (error) { showError(errorBox, error.message); setBusy(button, false); }
}

document.querySelector('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = '/'; });
init();
