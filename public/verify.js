import { api, escapeHtml, qs } from './shared.js';

const root = document.querySelector('#verifyStatus');
const token = qs('token');
const postVerifyContinuationKey = 'arl_post_verify_continue';

function readContinuation() {
  let raw;
  try {
    raw = localStorage.getItem(postVerifyContinuationKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || Number(value.expiresAt) < Date.now()) return null;
    if (value.kind === 'assessment' && typeof value.assessmentId === 'string' && value.assessmentId) {
      return { kind: 'assessment', assessmentId: value.assessmentId };
    }
    if (value.kind === 'path' && typeof value.path === 'string' && value.path.startsWith('/') && !value.path.startsWith('//')) {
      const candidate = new URL(value.path, location.origin);
      if (candidate.origin === location.origin) return { kind: 'path', path: `${candidate.pathname}${candidate.hash || ''}` };
    }
  } catch {
    return null;
  }
  return null;
}

function clearContinuation() {
  try {
    localStorage.removeItem(postVerifyContinuationKey);
  } catch {
    // The continuation is optional and contains no credentials.
  }
}

async function continuationTarget(continuation) {
  if (!continuation) return null;
  if (continuation.kind === 'path') return continuation.path;
  const dashboard = await api('/api/dashboard');
  const assessment = (dashboard.assessments || []).find((item) => item.id === continuation.assessmentId);
  if (!assessment?.access_token) return '/dashboard.html';
  return `/result.html?id=${encodeURIComponent(assessment.id)}&token=${encodeURIComponent(assessment.access_token)}`;
}

function setContinueLink(href, continuation) {
  const primary = document.querySelector('a.button.primary');
  if (!primary || !href) return;
  primary.href = href;
  primary.textContent = continuation?.kind === 'assessment' ? 'Continue assessment purchase' : 'Continue';
}

(async () => {
  if (!token) {
    root.className = 'error-box show';
    root.textContent = 'The verification token is missing.';
    return;
  }
  try {
    await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
    const continuation = readContinuation();
    let href = null;
    try {
      href = await continuationTarget(continuation);
    } catch {
      href = null;
    }
    clearContinuation();
    root.className = 'success-box';
    root.innerHTML = '<strong>Email verified.</strong><p>You can now purchase reports and run authorised inspection and red-team workflows.</p>';
    setContinueLink(href, continuation);
  } catch (error) {
    root.className = 'error-box show';
    root.innerHTML = escapeHtml(error.message);
  }
})();
