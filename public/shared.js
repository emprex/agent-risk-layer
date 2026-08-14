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
    button.dataset.original = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
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

export async function hydrateNav() {
  try {
    const { user } = await api('/api/auth/me');
    document.querySelectorAll('[data-auth-link]').forEach((link) => {
      if (user) {
        link.textContent = 'Dashboard';
        link.href = '/dashboard.html';
      } else {
        link.textContent = 'Sign in';
        link.href = '/auth.html';
      }
    });
    return user;
  } catch {
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

document.addEventListener('DOMContentLoaded', () => {
  hydrateHelpLink();
  hydrateNav();
  hydrateFooterLinks();
});
