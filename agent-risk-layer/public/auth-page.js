import { api, hideError, qs, setBusy, showError } from './shared.js';
const tabs = document.querySelectorAll('[data-tab]');
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

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((x) => x.classList.toggle('active', x === tab));
  login.hidden = tab.dataset.tab !== 'login';
  register.hidden = tab.dataset.tab !== 'register';
  mfa.hidden = true;
  hideError(errorBox);
}));

login.addEventListener('submit', (event) => submitLogin(event));
register.addEventListener('submit', (event) => submitRegister(event));
mfa.addEventListener('submit', submitMfa);

async function submitLogin(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Checking…');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: document.querySelector('#loginEmail').value,
      password: document.querySelector('#loginPassword').value,
      claimAssessmentId, claimToken,
    }) });
    if (data.mfaRequired) {
      challengeToken = data.challengeToken;
      login.hidden = true;
      mfa.hidden = false;
      document.querySelector('#mfaCode').focus();
      notice('Enter the six-digit authenticator code or one unused recovery code.');
      return;
    }
    location.href = next;
  } catch (error) { showError(errorBox, error.message); }
  finally { setBusy(button, false); }
}

async function submitRegister(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Creating…');
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
      email: document.querySelector('#registerEmail').value,
      password: document.querySelector('#registerPassword').value,
      termsAccepted: document.querySelector('#termsAccepted').checked,
      claimAssessmentId, claimToken,
    }) });
    sessionStorage.setItem('arl_registration_notice', 'Check your inbox and verify your email before purchasing reports or running security tools.');
    if (data.demoVerificationUrl) location.href = data.demoVerificationUrl;
    else location.href = next;
  } catch (error) { showError(errorBox, error.message); }
  finally { setBusy(button, false); }
}

async function submitMfa(event) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Verifying…');
  try {
    await api('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code: document.querySelector('#mfaCode').value }) });
    location.href = next;
  } catch (error) { showError(errorBox, error.message); }
  finally { setBusy(button, false); }
}

function notice(message) {
  noticeBox.textContent = message;
  noticeBox.hidden = false;
}

api('/api/auth/me').then(({ user }) => { if (user) location.href = next; }).catch(() => null);
