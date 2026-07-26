import { api, escapeHtml, money, setBusy, showError } from './shared.js';

const entitlements = {
  developer_monthly: ['3 security projects', '50,000 Guard decisions/month', '30-day runtime evidence retention', '5 active keys per project', '10 authorised red-team campaigns/30 days'],
  team_monthly: ['15 security projects', '250,000 Guard decisions/month', '90-day runtime evidence retention', '15 active keys per project', 'Shared workspaces, five roles and SCIM', '25 authorised red-team campaigns/30 days'],
  agency_monthly: ['50 security projects', '1,000,000 Guard decisions/month', '180-day runtime evidence retention', '30 active keys per project', 'Multi-assessment portfolio and signed integrations', '50 authorised red-team campaigns/30 days'],
};
const summaries = {
  developer_monthly: 'For individual builders protecting several production agents.',
  team_monthly: 'For engineering and security teams operating a shared AI estate.',
  agency_monthly: 'For consultancies and agencies managing multiple customer systems.',
};
const errorBox = document.querySelector('#pricingError');

init();

async function init() {
  try {
    const cfg = await api('/api/config');
    document.querySelector('#demoNotice').hidden = !cfg.demoMode;
    const cards = [communityCard(), assessmentCard(cfg.prices.pro_report), ...['developer_monthly', 'team_monthly', 'agency_monthly'].map((key) => recurringCard(key, cfg.prices[key])), enterpriseCard()];
    const grid = document.querySelector('#pricingGrid');
    grid.innerHTML = cards.join('');
    grid.querySelectorAll('[data-checkout]').forEach((button) => button.addEventListener('click', startCheckout));
  } catch (error) { showError(errorBox, error.message); }
}

function communityCard() {
  return `<article class="pricing-card"><h3>Community</h3><div class="price">£0</div><p>Prove the integration with one real agent before buying.</p><ul class="check-list"><li>1 security project</li><li>10,000 Guard decisions/month</li><li>7-day runtime evidence retention</li><li>2 active API keys</li><li>Private assessment and local Inspector</li></ul><p class="plan-next">No card. Controlled-beta invitation may be required.</p><a class="button ghost full" href="/control-plane.html">Start free</a></article>`;
}
function assessmentCard(plan) {
  return `<article class="pricing-card featured"><span class="badge">Founding offer</span><h3>${escapeHtml(plan.name)}</h3><div class="price">${money(plan.amountPence)}</div><p>One evidence-led security review for a launch or customer assurance request.</p><ul class="check-list"><li>Declared risk and technical evidence review</li><li>Controlled red-team campaign</li><li>Prioritised remediation ownership</li><li>Retest and deployment decision</li><li>Signed report and PDF delivery</li></ul><p class="plan-next">Complete the private assessment before checkout.</p><a class="button primary full" href="/assessment.html">Start assessment</a></article>`;
}
function recurringCard(key, plan) {
  const featured = key === 'team_monthly';
  return `<article class="pricing-card ${featured ? 'featured' : ''}">${featured ? '<span class="badge">Best for teams</span>' : ''}<h3>${escapeHtml(plan.name)}</h3><div class="price">${money(plan.amountPence).replace('.00', '')}<small>/month</small></div><p>${escapeHtml(summaries[key])}</p><ul class="check-list">${entitlements[key].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="plan-next">Cancel through the Stripe billing portal.</p><button class="button ${featured ? 'primary' : 'ghost'} full" data-checkout="${key}">Review secure checkout</button></article>`;
}
function enterpriseCard() {
  return `<article class="pricing-card"><h3>Enterprise</h3><div class="price">From £6,000<small>/year</small></div><p>For procurement, higher limits, deployment support and tailored assurance.</p><ul class="check-list"><li>Up to 500 projects and 10m checks/month</li><li>365-day evidence retention</li><li>SSO/SCIM and signed operational integrations</li><li>Deployment and security-review support</li><li>Custom limits and commercial terms</li></ul><p class="plan-next">Scoped proposal after technical qualification.</p><a class="button ghost full" href="mailto:support@agentrisklayer.com?subject=AgentRiskLayer%20Enterprise">Contact founder</a></article>`;
}

async function startCheckout(event) {
  const button = event.currentTarget;
  setBusy(button, true, 'Opening Stripe…');
  try {
    const { user } = await api('/api/auth/me');
    if (!user) {
      location.href = `/auth.html?next=${encodeURIComponent('/pricing.html')}`;
      return;
    }
    const { url } = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ productKey: button.dataset.checkout }) });
    location.href = url;
  } catch (error) {
    if (error.status === 401) location.href = `/auth.html?next=${encodeURIComponent('/pricing.html')}`;
    else { showError(errorBox, error.message); errorBox.scrollIntoView({ behavior: 'smooth' }); setBusy(button, false); }
  }
}
