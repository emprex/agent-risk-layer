const MEASUREMENT_ID = 'G-T1V035EGTB';
const CONSENT_KEY = 'agentrisklayer_analytics_consent';
const ONCE_PREFIX = 'arl_analytics_once:';
const JOURNEY_SOURCE_KEY = 'arl_journey_source';
const ALLOWED_JOURNEY_SOURCES = new Set(['arl17k']);
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

function storageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function consentState() {
  return storageGet(localStorage, CONSENT_KEY);
}

function loadAnalytics() {
  if (loaded || consentState() !== 'granted') return;
  loaded = true;
  window.gtag('consent', 'update', { analytics_storage: 'granted' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  script.referrerPolicy = 'strict-origin-when-cross-origin';
  script.addEventListener('error', () => { loaded = false; }, { once: true });
  document.head.appendChild(script);
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    anonymize_ip: true,
    cookie_flags: 'SameSite=Lax;Secure',
    send_page_view: true,
    transport_type: 'beacon'
  });
}

function safeParameters(parameters = {}) {
  return Object.fromEntries(
    Object.entries(parameters)
      .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) &&
        ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 100) : value])
  );
}

function track(name, parameters = {}) {
  if (consentState() !== 'granted') return false;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(String(name))) return false;
  loadAnalytics();
  window.gtag('event', String(name), safeParameters(parameters));
  return true;
}

function trackOnce(key, name, parameters = {}) {
  const marker = `${ONCE_PREFIX}${String(key).slice(0, 100)}`;
  if (storageGet(sessionStorage, marker) === '1') return false;
  if (!track(name, parameters)) return false;
  storageSet(sessionStorage, marker, '1');
  return true;
}

function setConsent(value) {
  const next = value === 'granted' ? 'granted' : 'denied';
  storageSet(localStorage, CONSENT_KEY, next);
  window.gtag('consent', 'update', {
    analytics_storage: next === 'granted' ? 'granted' : 'denied'
  });
  document.getElementById('analyticsConsent')?.remove();
  if (next === 'granted') {
    loadAnalytics();
    trackJourneyState();
  }
}

function showConsentBanner() {
  if (consentState()) return;
  const banner = document.createElement('section');
  banner.id = 'analyticsConsent';
  banner.className = 'analytics-consent';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Analytics preference');
  banner.innerHTML = `
    <div>
      <strong>Privacy choices</strong>
      <p>We use optional Google Analytics to understand website use and improve AgentRiskLayer. Analytics loads only if you accept. We do not use advertising cookies.</p>
    </div>
    <div class="analytics-consent-actions">
      <button type="button" class="button ghost small" data-analytics-consent="denied">Reject</button>
      <button type="button" class="button primary small" data-analytics-consent="granted">Accept</button>
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
  return element.dataset.plan || element.dataset.checkout || card?.dataset.plan ||
    card?.querySelector('h2,h3,strong')?.textContent?.trim().slice(0, 80) || 'unknown';
}

function currentPath() {
  return location.pathname === '/' ? '/' : location.pathname.replace(/\/$/, '');
}

function referrerPath() {
  try {
    return document.referrer ? new URL(document.referrer).pathname : '';
  } catch {
    return '';
  }
}

function captureJourneySource(params = new URLSearchParams(location.search)) {
  const explicit = String(params.get('from') || '').toLowerCase();
  if (ALLOWED_JOURNEY_SOURCES.has(explicit)) {
    storageSet(sessionStorage, JOURNEY_SOURCE_KEY, explicit);
    return explicit;
  }
  if (referrerPath() === '/arl17k.html') {
    storageSet(sessionStorage, JOURNEY_SOURCE_KEY, 'arl17k');
    return 'arl17k';
  }
  const stored = storageGet(sessionStorage, JOURNEY_SOURCE_KEY);
  return ALLOWED_JOURNEY_SOURCES.has(stored) ? stored : 'direct_or_other';
}

function observeConfirmedPurchase() {
  if (currentPath() !== '/success.html') return;
  const root = document.querySelector('#successRoot');
  if (!root) return;
  const check = () => {
    if (!/Payment and fulfilment completed\./i.test(root.textContent || '')) return false;
    trackOnce('purchase-confirmed', 'purchase', { source: 'stripe_checkout', entry_source: captureJourneySource() });
    return true;
  };
  if (check()) return;
  const observer = new MutationObserver(() => {
    if (check()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}

function trackJourneyState() {
  if (consentState() !== 'granted') return;
  const path = currentPath();
  const params = new URLSearchParams(location.search);
  const entrySource = captureJourneySource(params);

  if (path === '/assessment.html') {
    trackOnce('assessment-start', 'assessment_start', { entry_source: entrySource });
  }

  if (path === '/result.html' && storageGet(sessionStorage, 'arl_last_assessment')) {
    trackOnce('assessment-complete', 'assessment_complete', { entry_source: entrySource });
  }

  if (path === '/dashboard.html' && params.get('welcome') === '1') {
    trackOnce('sign-up-complete', 'sign_up', { method: 'email_password', entry_source: entrySource });
  } else if (path === '/dashboard.html' && referrerPath() === '/auth.html') {
    trackOnce('login-complete', 'login', { method: 'email_password', entry_source: entrySource });
  }

  if (path === '/pricing.html') {
    trackOnce('pricing-view', 'view_pricing', { entry_source: entrySource });
  }

  observeConfirmedPurchase();
}

document.addEventListener('click', event => {
  const target = event.target.closest('a,button');
  if (!target) return;
  const text = target.textContent.trim().toLowerCase();
  const href = target.getAttribute('href') || '';
  const entrySource = currentPath() === '/arl17k.html' ? 'arl17k' : captureJourneySource();

  if (target.matches('[data-plan], [data-checkout], #buyPro') ||
      /checkout|subscribe|upgrade|buy|choose plan|get reviewed assessment/.test(text)) {
    track('begin_checkout', { plan: planFromElement(target), entry_source: entrySource });
  } else if (/create (free )?account|sign up|register/.test(text) ||
             /auth\.html.*register/.test(href)) {
    track('sign_up_start', { entry_source: entrySource });
  } else if (/contact|request.*assessment|request.*quote|talk to/.test(text)) {
    track('generate_lead_start', { entry_source: entrySource });
  } else if (/sample.*report|download.*report/.test(text + ' ' + href)) {
    track('sample_report_view', { entry_source: entrySource });
  } else if (/assessment\.html/.test(href)) {
    track('assessment_cta_click', { entry_source: entrySource });
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  const id = String(form.id || '').toLowerCase();
  const action = (form.getAttribute('action') || location.pathname).toLowerCase();
  const entrySource = captureJourneySource();
  if (id === 'registerform' || /register|signup/.test(action)) {
    track('sign_up_submit', { entry_source: entrySource });
  } else if (id === 'loginform') {
    track('login_submit', { entry_source: entrySource });
  } else if (/contact|lead|quote/.test(action)) {
    track('generate_lead_submit', { entry_source: entrySource });
  }
});

window.AgentRiskAnalytics = Object.freeze({
  measurementId: MEASUREMENT_ID,
  track,
  trackOnce,
  consent: consentState,
  grant: () => setConsent('granted'),
  deny: () => setConsent('denied'),
  resetConsent: () => {
    try { localStorage.removeItem(CONSENT_KEY); } catch {}
    location.reload();
  }
});

if (consentState() === 'granted') {
  loadAnalytics();
  trackJourneyState();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    showConsentBanner();
    trackJourneyState();
  }, { once: true });
} else {
  showConsentBanner();
  trackJourneyState();
}
