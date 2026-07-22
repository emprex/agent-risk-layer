let csrfToken = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.csrfToken) throw new Error('Could not initialise the secure session. Refresh and try again.');
  csrfToken = payload.csrfToken;
  return csrfToken;
}

export async function api(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers['X-CSRF-Token'] = await getCsrfToken();

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    method,
    headers,
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || 'Request failed.');
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

export function downloadObject(filename, object) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', hydrateNav);
