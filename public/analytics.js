const MEASUREMENT_ID = 'G-T1V035EGTB';
const CONSENT_KEY = 'agentrisklayer_analytics_consent';
let loaded = false;

window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function gtag() {
  window.dataLayer.push(arguments);
};

window.gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});
window.gtag('set', {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  restricted_data_processing: true
});

function loadAnalytics() {
  if (loaded) return;
  loaded = true;
  window.gtag('consent', 'update', { analytics_storage: 'granted' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  script.referrerPolicy = 'strict-origin-when-cross-origin';
  document.head.appendChild(script);
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    anonymize_ip: true,
    cookie_flags: 'SameSite=Lax;Secure',
    send_page_view: true,
    transport_type: 'beacon'
  });
}

function track(name, parameters = {}) {
  if (localStorage.getItem(CONSENT_KEY) !== 'granted') return;
  loadAnalytics();
  const safe = Object.fromEntries(
    Object.entries(parameters).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value)
    )
  );
  window.gtag('event', name, safe);
}

function setConsent(value) {
  localStorage.setItem(CONSENT_KEY, value);
  window.gtag('consent', 'update', {
    analytics_storage: value === 'granted' ? 'granted' : 'denied'
  });
  document.getElementById('analyticsConsent')?.remove();
  if (value === 'granted') loadAnalytics();
}

function showConsentBanner() {
  if (localStorage.getItem(CONSENT_KEY)) return;
  const banner = document.createElement('section');
  banner.id = 'analyticsConsent';
  banner.className = 'analytics-consent';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Analytics preference');
  banner.innerHTML = `
    <div>
      <strong>Privacy choices</strong>
      <p>We use optional Google Analytics to understand website use and improve AgentRiskLayer. Analytics loads only if you accept. We do not use advertising cookies.</p>
    </div>
    <div class="analytics-consent-actions">
      <button type="button" class="button ghost small" data-analytics-consent="denied">Reject optional analytics</button>
      <button type="button" class="button primary small" data-analytics-consent="granted">Accept analytics</button>
      <a href="/privacy.html">Privacy notice</a>
    </div>`;
  document.body.appendChild(banner);
  banner.addEventListener('click', event => {
    const button = event.target.closest('[data-analytics-consent]');
    if (button) setConsent(button.dataset.analyticsConsent);
  });
}

function planFromElement(element) {
  const card = element.closest('[data-plan], .pricing-card, article');
  return element.dataset.plan || card?.dataset.plan ||
    card?.querySelector('h2,h3,strong')?.textContent?.trim() || 'unknown';
}

document.addEventListener('click', event => {
  const target = event.target.closest('a,button');
  if (!target) return;
  const text = target.textContent.trim().toLowerCase();
  const href = target.getAttribute('href') || '';

  if (target.matches('[data-plan], [data-checkout]') ||
      /checkout|subscribe|upgrade|buy|choose plan/.test(text)) {
    track('begin_checkout', { plan: planFromElement(target) });
  } else if (/create (free )?account|sign up|register/.test(text) ||
             /auth\.html.*register/.test(href)) {
    track('sign_up_start');
  } else if (/contact|request.*assessment|request.*quote|talk to/.test(text)) {
    track('generate_lead_start');
  } else if (/sample.*report|download.*report/.test(text + ' ' + href)) {
    track('sample_report_view');
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  const action = (form.getAttribute('action') || location.pathname).toLowerCase();
  if (/auth|register|signup/.test(action) ||
      new URLSearchParams(location.search).get('mode') === 'register') {
    track('sign_up_submit');
  } else if (/contact|lead|quote/.test(action)) {
    track('generate_lead_submit');
  }
});

window.AgentRiskAnalytics = Object.freeze({
  track,
  grant: () => setConsent('granted'),
  deny: () => setConsent('denied'),
  resetConsent: () => {
    localStorage.removeItem(CONSENT_KEY);
    location.reload();
  }
});

if (localStorage.getItem(CONSENT_KEY) === 'granted') loadAnalytics();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showConsentBanner, { once: true });
} else {
  showConsentBanner();
}
