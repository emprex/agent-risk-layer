import { api, escapeHtml, money, setBusy, showError } from './shared.js';

const entitlements = {
  developer_monthly: ['3 security projects', '50,000 Guard decisions/month', '30-day runtime evidence retention', '5 active keys per project', '10 authorised red-team campaigns/30 days'],
  team_monthly: ['15 security projects', '250,000 Guard decisions/month', '90-day runtime evidence retention', '15 active keys per project', 'Shared workspaces, five roles and SCIM', '25 authorised red-team campaigns/30 days'],
  agency_monthly: ['50 security projects', '1,000,000 Guard decisions/month', '180-day runtime evidence retention', '30 active keys per project', 'Multi-assessment portfolio and signed integrations', '50 authorised red-team campaigns/30 days'],
};
const summaries = {
  developer_monthly: 'For one builder who needs to protect and recheck several agents.',
  team_monthly: 'For a team that needs shared ownership, evidence and live protection.',
  agency_monthly: 'For a service provider managing security work across customer projects.',
};
const errorBox = document.querySelector('#pricingError');

init();

async function init() {
  try {
    const cfg = await api('/api/config');
    const demoNotice = document.querySelector('#demoNotice');
    if (cfg.demoMode) {
      demoNotice.textContent = 'Demo mode is active. Subscription checkout is simulated and can be cancelled from the dashboard.';
      demoNotice.hidden = false;
    }
    const cards = [communityCard(), assessmentCard(cfg.prices.pro_report), ...['developer_monthly', 'team_monthly', 'agency_monthly'].map((key) => recurringCard(key, cfg.prices[key])), enterpriseCard()];
    const grid = document.querySelector('#pricingGrid');
    grid.innerHTML = cards.join('');
    grid.querySelectorAll('[data-checkout]').forEach((button) => button.addEventListener('click', startCheckout));
  } catch (error) { showError(errorBox, error.message); }
}

function communityCard() {
  return `<article class="pricing-card-v10">
    <div class="plan-heading"><span class="plan-purpose">START HERE</span><h3>Community</h3><p>Understand one agent and try live protection before buying.</p></div>
    <div class="plan-price">£0 <small>forever</small></div>
    <a class="button ghost full" href="/assessment.html">Check an agent free</a>
    <div class="plan-outcome"><strong>Best when you need to:</strong><span>Find the first risks and protect one active project.</span></div>
    <ul class="plain-plan-list"><li>1 security project</li><li>10,000 Guard decisions each month</li><li>7-day runtime evidence retention</li><li>2 active API keys</li><li>Private risk check and local Inspector</li></ul>
    <p class="plan-note">No payment card required.</p>
  </article>`;
}
function assessmentCard(plan) {
  return `<article class="pricing-card-v10 recommended">
    <div class="plan-heading"><span class="plan-purpose">REVIEWED DECISION</span><span class="plan-badge">Recommended first purchase</span><h3>${escapeHtml(plan.name)}</h3><p>Evidence-led review and a decision for one agent.</p></div>
    <div class="plan-price">${money(plan.amountPence)} <small>one time</small></div>
    <a class="button primary full" href="/assessment.html">Start with the free check</a>
    <div class="plan-outcome"><strong>Best when you need to:</strong><span>Support a launch, customer review or accountable go/no-go decision.</span></div>
    <ul class="plain-plan-list"><li>Complete risk and evidence review</li><li>Controlled attack simulation</li><li>Prioritised fixes with named ownership</li><li>Retest criteria and deployment decision</li><li>Signed report and PDF delivery</li></ul>
    <p class="plan-note">Complete the private check before checkout.</p>
  </article>`;
}
function recurringCard(key, plan) {
  const featured = key === 'team_monthly';
  const purpose = key === 'developer_monthly' ? 'FOR BUILDERS' : key === 'team_monthly' ? 'FOR SHARED OWNERSHIP' : 'FOR CLIENT WORK';
  const outcome = key === 'developer_monthly' ? 'Protect several agents as one builder.' : key === 'team_monthly' ? 'Share projects, roles and evidence across a team.' : 'Manage a larger portfolio of customer security work.';
  return `<article class="pricing-card-v10 ${featured ? 'recommended' : ''}">
    <div class="plan-heading"><span class="plan-purpose">${purpose}</span>${featured ? '<span class="plan-badge">Best for teams</span>' : ''}<h3>${escapeHtml(plan.name)}</h3><p>${escapeHtml(summaries[key])}</p></div>
    <div class="plan-price">${money(plan.amountPence).replace('.00', '')} <small>per month</small></div>
    <button class="button ${featured ? 'primary' : 'ghost'} full" data-checkout="${key}">Choose ${escapeHtml(plan.name)}</button>
    <div class="plan-outcome"><strong>Best when you need to:</strong><span>${escapeHtml(outcome)}</span></div>
    <ul class="plain-plan-list">${entitlements[key].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    <p class="plan-note">Cancel through the Stripe billing portal.</p>
  </article>`;
}
function enterpriseCard() {
  return `<article class="pricing-card-v10 enterprise-plan">
    <div class="plan-heading"><span class="plan-purpose">SCOPED ASSURANCE</span><h3>Enterprise</h3><p>Higher limits, procurement support and tailored deployment work.</p></div>
    <div class="plan-price">From £6,000 <small>per year</small></div>
    <a class="button ghost full" href="mailto:support@agentrisklayer.com?subject=AgentRiskLayer%20Enterprise">Request a scoped proposal</a>
    <div class="plan-outcome"><strong>Best when you need to:</strong><span>Qualify a larger deployment and agree exact operational requirements.</span></div>
    <ul class="plain-plan-list"><li>Up to 500 projects and 10m checks/month</li><li>365-day evidence retention</li><li>SSO, SCIM and signed integrations</li><li>Deployment and security-review support</li><li>Custom limits and commercial terms</li></ul>
    <p class="plan-note">Proposal only after technical qualification.</p>
  </article>`;
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
