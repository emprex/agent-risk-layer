import { api, escapeHtml, qs } from './shared.js';
import { parsePostVerifyContinuation, POST_VERIFY_CONTINUATION_KEY, targetForContinuation } from './post-verify-continuation.js';

const root = document.querySelector('#verifyStatus');
const token = qs('token');

function readContinuation() {
  try {
    return parsePostVerifyContinuation(localStorage.getItem(POST_VERIFY_CONTINUATION_KEY), { origin: location.origin });
  } catch {
    return null;
  }
}

function clearContinuation() {
  try {
    localStorage.removeItem(POST_VERIFY_CONTINUATION_KEY);
  } catch {
    // The continuation is optional and contains no credentials.
  }
}

async function continuationTarget(continuation) {
  if (!continuation) return null;
  const dashboard = await api('/api/dashboard');
  return targetForContinuation(continuation, dashboard.assessments || []);
}

function setContinueLink(href, continuation) {
  const primary = document.querySelector('a.button.primary');
  if (!primary || !href) return;
  primary.href = href;
  primary.textContent = continuation?.kind === 'assessment' ? 'Continue assessment' : 'Continue';
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
    let continuationResolved = !continuation;
    try {
      href = await continuationTarget(continuation);
      continuationResolved = true;
    } catch {
      href = null;
    }
    if (continuationResolved) clearContinuation();
    root.className = 'success-box';
    root.innerHTML = '<strong>Email verified.</strong><p>Your email is verified. You can now continue authorised assessment workflows.</p>';
    setContinueLink(href, continuation);
  } catch (error) {
    root.className = 'error-box show';
    root.innerHTML = escapeHtml(error.message);
  }
})();
