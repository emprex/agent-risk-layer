import { api, escapeHtml, money } from './shared.js';
const root = document.querySelector('#adminRoot');

async function init() {
  try {
    const { totals, funnel, recentFailures, riskBands, readiness } = await api('/api/admin/analytics');
    root.className = '';
    root.innerHTML = `
      <div class="dashboard-stats">
        <div class="stat"><span>Users</span><strong>${totals.users}</strong></div>
        <div class="stat"><span>Assessments</span><strong>${totals.assessments}</strong></div>
        <div class="stat"><span>Paid purchases</span><strong>${totals.purchases}</strong></div>
        <div class="stat"><span>Recorded revenue</span><strong class="money-stat">${money(totals.revenuePence)}</strong></div>
      </div>
      <div class="dashboard-grid">
        <section class="panel"><h2>Product funnel</h2>${rows(funnel, (item) => item.name.replaceAll('_', ' '), (item) => item.count)}</section>
        <aside class="panel"><h2>Launch readiness</h2><div class="readiness-banner ${readiness.ready ? 'ready' : 'blocked'}">${readiness.ready ? 'READY' : 'BLOCKED'}</div>${readiness.checks.map((check) => `<div class="readiness-row"><span>${escapeHtml(check.label)}${check.required ? ' *' : ''}</span><strong class="${check.ok ? 'pass-text' : check.required ? 'fail-text' : 'muted'}">${check.ok ? 'PASS' : check.required ? 'FAIL' : 'OPTIONAL'}</strong></div>`).join('')}</aside>
      </div>
      <div class="dashboard-grid section-gap">
        <section class="panel"><h2>Assessment risk bands</h2>${rows(riskBands, (item) => item.band, (item) => item.count)}</section>
        <aside class="panel"><h2>Subscriptions</h2><div class="stat"><span>Active subscriptions</span><strong>${totals.activeSubscriptions}</strong></div></aside>
      </div>
      <section class="panel section-gap"><h2>Recent email failures</h2>${recentFailures.length ? recentFailures.map((item) => `<div class="assessment-row"><div><strong>${escapeHtml(item.subject)}</strong><div class="assessment-meta"><span>${escapeHtml(item.to_email)}</span><span>${new Date(item.created_at).toLocaleString('en-GB')}</span></div><p class="fail-text small-copy">${escapeHtml(item.error || 'Unknown provider error')}</p></div></div>`).join('') : '<p class="muted">No failed email deliveries.</p>'}</section>`;
  } catch (error) {
    if (error.message.includes('Sign in')) location.href = `/auth.html?next=${encodeURIComponent('/admin.html')}`;
    else root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

function rows(items, label, value) {
  return items.length ? items.map((item) => `<div class="assessment-row"><strong>${escapeHtml(label(item))}</strong><span class="score-badge">${escapeHtml(value(item))}</span></div>`).join('') : '<p class="muted">No data yet.</p>';
}

init();
