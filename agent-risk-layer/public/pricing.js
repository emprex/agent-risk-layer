import { api, escapeHtml, money, setBusy, showError } from './shared.js';
const grid = document.querySelector('#pricingGrid');
const errorBox = document.querySelector('#pricingError');
let user;
const descriptions = {
  basic_report: ['All material findings', 'Prioritised controls', '30-day action plan', 'PDF and email delivery'],
  pro_report: ['Everything in Essential', 'Deployment decision', 'Verification checklist', 'Complete response evidence'],
  developer_monthly: ['Professional access for saved assessments', 'Central assessment history', 'Subscription portal', 'Automatic Stripe invoices'],
  agency_monthly: ['Professional access for client assessments', 'Public summaries and badges', 'Client-ready report evidence', 'Priority support channel'],
};
const summaries = {
  basic_report: 'A one-off remediation report for one completed assessment.',
  pro_report: 'Decision-ready evidence for one launch or architecture review.',
  developer_monthly: 'Ongoing professional reporting for one builder account.',
  agency_monthly: 'Ongoing client-facing reporting for consultants and agencies.',
};
async function init() {
  try {
    const cfg = await api('/api/config');
    user = cfg.user;
    if (cfg.demoMode) document.querySelector('#demoNotice').hidden = false;
    grid.innerHTML = Object.entries(cfg.prices).map(([key, plan]) => `<article class="pricing-card ${key === 'pro_report' ? 'featured' : ''}">${key === 'pro_report' ? '<span class="badge">Recommended</span>' : ''}<h3>${escapeHtml(plan.name)}</h3><div class="price">${money(plan.amountPence, plan.recurring).replace('/month', '<small>/month</small>')}</div><p>${escapeHtml(summaries[key])}</p><ul class="check-list">${descriptions[key].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><button class="button ${key === 'pro_report' ? 'primary' : 'ghost'} full" data-plan="${key}">${plan.recurring ? 'Start plan' : 'Complete an assessment'}</button></article>`).join('');
    grid.querySelectorAll('[data-plan]').forEach((button) => button.addEventListener('click', () => choose(button.dataset.plan, button)));
  } catch (error) { showError(errorBox, error.message); }
}
async function choose(key, button) {
  if (!key.includes('monthly')) { location.href = '/assessment.html'; return; }
  if (!user) { location.href = `/auth.html?next=${encodeURIComponent('/pricing.html')}`; return; }
  setBusy(button, true, 'Opening checkout…');
  try { const { url } = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ productKey: key }) }); location.href = url; }
  catch (error) { showError(errorBox, error.message); setBusy(button, false); }
}
init();
