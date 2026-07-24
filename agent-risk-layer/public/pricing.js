import { api, escapeHtml, money, setBusy, showError } from './shared.js';
const grid = document.querySelector('#pricingGrid');
const errorBox = document.querySelector('#pricingError');
let user;
const descriptions = {
  basic_report: ['Complete declared-risk findings', 'Local Inspector technical summary', 'Prioritised 30-day remediation plan', 'PDF and email delivery'],
  pro_report: ['Everything in Essential', 'Full observed-evidence register', '2 authorised red-team campaigns for this assessment', '32-case catalogue, repeated trials, reproduced evidence and retest criteria'],
  developer_monthly: ['Repeat professional assessments and local scans', '10 authorised red-team campaigns per rolling 30 days', 'Technical posture and adversarial drift history', 'Saved evidence-backed reports and billing portal'],
  agency_monthly: ['Multi-assessment portfolio in one secured account', '50 authorised red-team campaigns per rolling 30 days', 'Client-ready evidence and adversarial reports', 'Repeat testing, comparison and remediation workflow'],
};
const summaries = {
  basic_report: 'A concise evidence-aware security review for one AI-agent system.',
  pro_report: 'The complete controlled-beta launch review: declared risk, static evidence and authorised staging tests.',
  developer_monthly: 'Continuous assurance for builders who inspect, attack safely, remediate and retest.',
  agency_monthly: 'Evidence-led AI security reviews and controlled campaigns across multiple client systems.',
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
