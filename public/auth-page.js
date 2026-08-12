import { api, hideError, qs, setBusy, showError, warmCsrf } from './shared.js';
import { buildPostVerifyContinuation, POST_VERIFY_CONTINUATION_KEY } from './purchase-continuation.js';

const tabs = [...document.querySelectorAll('[data-tab]')];
const login = document.querySelector('#loginForm');
const register = document.querySelector('#registerForm');
const mfa = document.querySelector('#mfaForm');
const errorBox = document.querySelector('#authError');
const noticeBox = document.querySelector('#authNotice');
const claimAssessmentId = qs('claimAssessmentId');
const claimToken = qs('claimToken');
const requestedNext = qs('next') || '/dashboard.html';
const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard.html';
let challengeToken = '';

function selectTab(name, { focus = false } = {}) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  login.hidden = name !== 'login';
  register.hidden = name !== 'register';
  mfa.hidden = true;
  hideError(errorBox);
  noticeBox.hidden = true;
  document.querySelector('#authTitle').textContent = name === 'register' ? 'Create your free account' : 'Welcome back';
  if (focus) document.querySelector(name === 'register' ? '#registerEmail' : '#loginEmail')?.focus();
  const url = new URL(location.href);
  if (name === 'register') url.searchParams.set('mode', 'register');
  else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
}

function rememberPostVerifyContinuation() {
  const record = buildPostVerifyContinuation({ claimAssessmentId, next, origin: location.origin });
  if (!record) return;
  try {
    localStorage.setItem(POST_VERIFY_CONTINUATION_KEY, JSON.stringify(record));
  } catch {
    // Continuation is a convenience only. Checkout authorization remains server-enforced.
  }
}

function showVerificationWait() {
  login.hidden = true;
  register.hidden = true;
  mfa.hidden = true;
  hideError(errorBox);
  document.querySelector('#authTitle').textContent = 'Check your email';
  noticeBox.hidden = false;
  noticeBox.textContent = '';

  const message = document.createElement('p');
  message.textContent = 'Your account is created. Verify your email, then come back here and continue. We will return you to the purchase you started.';
  const status = document.createElement('p');
  status.className = 'muted small-copy';
  status.textContent = 'Waiting for email verification.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button primary';
  button.textContent = 'I have verified my email';
  button.addEventListener('click', async () => {
    setBusy(button, true, 'Checking…');
    try {
      const { user } = await api('/api/auth/me');
      if (user?.emailVerified) {
        location.href = next;
        return;
      }
      status.textContent = 'Your email is not verified yet. Use the verification link in your inbox, then try again.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
  noticeBox.append(message, status, button);
}

tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab, { focus: true })));
document.querySelector('#backToLogin').addEventListener('click', () => selectTab('login', { focus: true }));
document.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
  const input = document.querySelector(`#${CSS.escape(button.dataset.togglePassword)}`);
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? 'Hide' : 'Show';
  button.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} password`);
  input.focus();
}));

login.addEventListener('submit', submitLogin);
register.addEventListener('submit', submitRegister);
mfa.addEventListener('submit', submitMfa);

async function submitLogin(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Signing in…');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: document.querySelector('#loginEmail').value.trim(),
      password: document.querySelector('#loginPassword').value,
      claimAssessmentId, claimToken,
    }) });
    if (data.mfaRequired) {
      challengeToken = data.challengeToken;
      login.hidden = true;
      register.hidden = true;
      mfa.hidden = false;
      document.querySelector('#authTitle').textContent = 'Verify your identity';
      document.querySelector('#mfaCode').focus();
      notice('Enter the six-digit code from your authenticator or an unused recovery code.');
      return;
    }
    location.href = next;
  } catch (error) {
    showError(errorBox, error.message);
  } finally {
    setBusy(button, false);
  }
}

async function submitRegister(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Creating account…');
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
      email: document.querySelector('#registerEmail').value.trim(),
      password: document.querySelector('#registerPassword').value,
      termsAccepted: document.querySelector('#termsAccepted').checked,
      claimAssessmentId, claimToken,
    }) });
    sessionStorage.setItem('arl_registration_notice', 'Account created. Check your inbox and verify your email to unlock all security operations.');
    rememberPostVerifyContinuation();
    if (data.demoVerificationUrl) {
      location.href = data.demoVerificationUrl;
      return;
    }
    if (data.verificationRequired) {
      showVerificationWait();
      return;
    }
    location.href = next;
  } catch (error) {
    showError(errorBox, error.message);
  } finally {
    setBusy(button, false);
  }
}

async function submitMfa(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Verifying…');
  try {
    await api('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code: document.querySelector('#mfaCode').value.trim() }) });
    location.href = next;
  } catch (error) {
    showError(errorBox, error.message);
  } finally {
    setBusy(button, false);
  }
}

function notice(message) {
  noticeBox.textContent = message;
  noticeBox.hidden = false;
}

selectTab(qs('mode') === 'register' ? 'register' : 'login');
const email = qs('email');
if (email) document.querySelector(qs('mode') === 'register' ? '#registerEmail' : '#loginEmail').value = email;
warmCsrf().catch(() => notice('Secure session initialisation will retry automatically when you submit the form.'));
api('/api/auth/me').then(({ user }) => { if (user) location.href = next; }).catch(() => null);
