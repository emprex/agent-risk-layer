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
