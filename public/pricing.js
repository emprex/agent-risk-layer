import { api, escapeHtml, money, setBusy, showError } from './shared.js';
import { resolvePricingMode } from './pricing-mode.js';

const errorBox = document.querySelector('#pricingError');
let pricingMode = { mode: 'unknown', allowCheckout: false, showDemoNotice: false, message: '' };

init();

async function init() {
  try {
    const cfg = await api('/api/config');
    pricingMode = resolvePricingMode(cfg);
    const demoNotice = document.querySelector('#demoNotice');
    if (pricingMode.showDemoNotice) {
      demoNotice.textContent = pricingMode.message;
      demoNotice.hidden = false;
    } else {
      demoNotice.textContent = '';
      demoNotice.hidden = true;
    }
    const grid = document.querySelector('#pricingGrid');
    grid.innerHTML = renderCatalogue(cfg.catalogue, Boolean(cfg.user));
    grid.querySelectorAll('[data-checkout]').forEach((button) => button.addEventListener('click', startCheckout));
    if (!pricingMode.allowCheckout) {
      grid.querySelectorAll('[data-checkout]').forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.dataset.original = button.textContent;
        button.textContent = 'Checkout temporarily unavailable';
      });
      showError(errorBox, pricingMode.message);
    }
  } catch (error) { showError(errorBox, error.message); }
}

function formatLimit(value) { return Number(value).toLocaleString('en-GB'); }
function limitList(plan) {
  const limits = plan.limits || {};
  return [limits.projects && `${formatLimit(limits.projects)} security ${limits.projects === 1 ? 'project' : 'projects'}`, limits.runtimeRequestsPerMonth && `${formatLimit(limits.runtimeRequestsPerMonth)} Guard decisions/month`, limits.retentionDays && `${limits.retentionDays}-day evidence retention`, limits.apiKeysPerProject && `${limits.apiKeysPerProject} active keys per project`, limits.redTeamRuns && `${limits.redTeamRuns} controlled-test runs/30 days`].filter(Boolean);
}
function tier(plan) {
  return `<article class="protect-tier"><div><h3>${escapeHtml(plan.name)}</h3><p>${escapeHtml(plan.description)}</p></div><strong>${money(plan.amountPence).replace('.00','')} <small>/month</small></strong><ul>${limitList(plan).map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul><button class="button ghost full" data-checkout="${plan.key}">Choose ${escapeHtml(plan.name)}</button></article>`;
}
function renderCatalogue(catalogue, authenticated) {
  if (!catalogue) throw new Error('Current commercial catalogue is unavailable.');
  const start=catalogue.community, assess=catalogue.pro_report, enterprise=catalogue.enterprise;
  const protect=['developer_monthly','team_monthly','agency_monthly'].map((key)=>catalogue[key]);
  return `<article class="commercial-step start-step" data-commercial-group="start"><div class="commercial-index">01</div><div><span class="plan-purpose">START</span><h2>${escapeHtml(start.name)}</h2><p>${escapeHtml(start.description)}</p></div><div class="commercial-price">£0</div><a class="button ghost" href="/assessment.html">Check an agent free</a></article>
  <article class="commercial-step assess-step" data-commercial-group="assess"><div class="commercial-index">02</div><div><span class="plan-purpose">ASSESS · PRIMARY PAID STEP</span><h2>${escapeHtml(assess.name)}</h2><p>${escapeHtml(assess.description)}</p><ul class="assessment-includes">${assess.includes.map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="truth-note">Purchasing does not itself perform a human review, run a test or certify the agent. Inspection and controlled testing are reported only when completed.</p></div><div class="commercial-price">${money(assess.amountPence).replace('.00','')} <small>once</small></div><a class="button primary button-xl" href="/assessment.html">${authenticated ? 'Continue assessment' : 'Start assessment'}</a></article>
  <section class="commercial-step protect-step" data-commercial-group="protect"><div class="commercial-index">03</div><div class="protect-heading"><div><span class="plan-purpose">PROTECT</span><h2>Ongoing protection</h2><p>Choose capacity only after deciding you need ongoing runtime protection.</p></div><div class="commercial-price">From ${money(protect[0].amountPence).replace('.00','')} <small>/month</small></div></div><div class="protect-tier-grid">${protect.map(tier).join('')}</div></section>
  <article class="commercial-step enterprise-step" data-commercial-group="enterprise"><div class="commercial-index">04</div><div><span class="plan-purpose">ENTERPRISE</span><h2>${escapeHtml(enterprise.name)}</h2><p>${escapeHtml(enterprise.description)}</p></div><div class="commercial-price">From ${money(enterprise.amountPence).replace('.00','')} <small>/year</small></div><a class="button ghost" href="mailto:support@agentrisklayer.com?subject=AgentRiskLayer%20Enterprise">Request scoped proposal</a></article>`;
}

async function startCheckout(event) {
  const button = event.currentTarget;
  if (!pricingMode.allowCheckout) {
    showError(errorBox, pricingMode.message || 'Checkout is temporarily unavailable.');
    errorBox.scrollIntoView({ behavior: 'smooth' });
    return;
  }
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
