let csrfToken = null;
let csrfPromise = null;

async function getCsrfToken({ force = false } = {}) {
  if (force) {
    csrfToken = null;
    csrfPromise = null;
  }
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.csrfToken) throw new Error('Could not initialise the secure session. Refresh and try again.');
        csrfToken = payload.csrfToken;
        return csrfToken;
      })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

export function warmCsrf() {
  return getCsrfToken();
}

export async function api(url, options = {}) {
  return request(url, options, true);
}

async function request(url, options, allowCsrfRetry) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const changesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (changesState) headers['X-CSRF-Token'] = await getCsrfToken();

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    method,
    headers,
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();

  const csrfFailure = response.status === 403 && changesState
    && String(payload?.error || payload || '').toLowerCase().includes('security token');
  if (csrfFailure && allowCsrfRetry) {
    await getCsrfToken({ force: true });
    return request(url, options, false);
  }
  if (!response.ok) {
    const error = new Error(payload?.error || payload || 'Request failed.');
    error.status = response.status;
    error.code = payload?.code || '';
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function money(pence, recurring = false, currency = 'GBP') {
  const value = new Intl.NumberFormat('en-GB', { style: 'currency', currency: String(currency || 'GBP').toUpperCase() }).format(Number(pence || 0) / 100);
  return recurring ? `${value}/month` : value;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export function riskClass(band) {
  return String(band || '').toLowerCase();
}

export function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.original) button.dataset.original = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
    delete button.dataset.original;
    button.disabled = false;
  }
}

export function showError(box, message) {
  box.textContent = message;
  box.classList.add('show');
}

export function hideError(box) {
  box.textContent = '';
  box.classList.remove('show');
}

function isAnonymousAssessmentJourney() {
  if (document.body?.dataset.shell !== 'app') return false;
  return location.pathname.endsWith('/assessment.html') || location.pathname.endsWith('/result.html');
}

function anonymousAuthHref() {
  const next = `${location.pathname}${location.search}${location.hash}`;
  const params = new URLSearchParams({ next });
  if (location.pathname.endsWith('/result.html')) {
    const current = new URLSearchParams(location.search);
    const assessmentId = current.get('id');
    const token = current.get('token');
    if (assessmentId && token) {
      params.set('claimAssessmentId', assessmentId);
      params.set('claimToken', token);
    }
  }
  return `/auth.html?${params.toString()}`;
}

function hydrateAnonymousAssessmentNavigation() {
  if (!isAnonymousAssessmentJourney()) return;
  const navigation = document.querySelector('[data-primary-navigation]');
  if (!navigation) return;

  navigation.querySelector('#logout')?.remove();
  navigation.replaceChildren();
  const items = [
    ['Home', '/'],
    ['How it works', '/#how-it-works'],
    ['Pricing', '/pricing.html'],
    ['Trust', '/trust.html'],
    ['Help', '/help.html'],
  ];
  for (const [label, href] of items) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    navigation.append(link);
  }
  const signIn = document.createElement('a');
  signIn.href = anonymousAuthHref();
  signIn.textContent = 'Sign in';
  signIn.className = 'nav-signin';
  signIn.dataset.authLink = '';
  navigation.append(signIn);
  delete navigation.dataset.workspaceNavigation;
  navigation.dataset.anonymousAssessmentNavigation = 'true';
  navigation.setAttribute('aria-label', 'Assessment navigation');

  const brand = document.querySelector('.brand-v10');
  if (brand) {
    brand.href = '/';
    brand.setAttribute('aria-label', 'AgentRiskLayer home');
    const subtitle = brand.querySelector('small');
    if (subtitle) subtitle.textContent = 'AI agent security';
  }
}

export async function hydrateNav() {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) hydrateAnonymousAssessmentNavigation();
    document.querySelectorAll('[data-auth-link]').forEach((link) => {
      if (user) {
        link.textContent = 'Dashboard';
        link.href = '/dashboard.html';
      } else if (!isAnonymousAssessmentJourney()) {
        link.textContent = 'Sign in';
        link.href = '/auth.html';
      }
    });
    return user;
  } catch {
    hydrateAnonymousAssessmentNavigation();
    return null;
  }
}

export function hydrateHelpLink() {
  // Public v10 pages intentionally keep primary navigation focused on Product,
  // How it works, Pricing, Trust and conversion. Help remains available in the
  // footer. The authenticated shell owns its own contextual Help destination.
  if (document.body?.dataset.shell === 'public' || document.body?.dataset.shell === 'app') return;
  const nav = document.querySelector('.site-header nav');
  if (!nav || nav.querySelector('a[href^="/help.html"]')) return;
  const link = document.createElement('a');
  const page = location.pathname;
  const section = page.includes('inspector') ? '#inspector'
    : page.includes('redteam') ? '#redteam'
      : page.includes('assessment') ? '#assessment'
        : page.includes('result') ? '#reports'
          : page.includes('pricing') ? '#plans' : '';
  link.href = `/help.html${section}`;
  link.textContent = 'Help';
  const authLink = nav.querySelector('[data-auth-link]');
  const logout = nav.querySelector('#logout');
  nav.insertBefore(link, authLink || logout || null);
}

export function hydrateFooterLinks() {
  const footer = document.querySelector('footer');
  if (!footer || footer.classList.contains('site-footer-v10') || footer.querySelector('.footer-links')) return;
  const links = document.createElement('span');
  links.className = 'footer-links';
  links.innerHTML = '<a href="/company.html">Company</a><a href="/status.html">Status</a><a href="/security-center.html">Security</a><a href="/trust.html">Trust</a><a href="/help.html">Help</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a>';
  footer.appendChild(links);
}

export function downloadObject(filename, object) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function restoreCheckoutReturnState(attempt = 0) {
  if (!location.pathname.endsWith('/result.html')) return;
  const params = new URLSearchParams(location.search);
  const cancelled = params.get('cancelled') === '1';
  const button = document.querySelector('#buyPro');
  const busy = Boolean(button && /Opening secure checkout/i.test(button.textContent || ''));
  const decision = document.querySelector('.result-decision-card');

  if (!cancelled && !busy) return;
  if (!button && !decision) {
    if (attempt < 20) setTimeout(() => restoreCheckoutReturnState(attempt + 1), 100);
    return;
  }

  if (button) {
    button.textContent = button.dataset.original || 'Get Security Assessment · £99';
    button.disabled = false;
    delete button.dataset.original;
  }

  if (!document.querySelector('.checkout-return-notice')) {
    const notice = document.createElement('div');
    notice.className = 'notice warning checkout-return-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<strong>Checkout was not completed on this page.</strong><span> Your assessment has been preserved. You can continue to secure checkout when you are ready.</span>';
    if (decision) decision.before(notice);
    else document.querySelector('#resultRoot')?.prepend(notice);
  }

  if (cancelled) {
    params.delete('cancelled');
    const query = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }
}

window.addEventListener('pageshow', () => {
  setTimeout(() => restoreCheckoutReturnState(), 0);
});

document.addEventListener('DOMContentLoaded', () => {
  hydrateHelpLink();
  hydrateNav();
  hydrateFooterLinks();
  restoreCheckoutReturnState();
});
