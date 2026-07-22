import { api, hideError, qs, setBusy, showError } from './shared.js';
const tabs = document.querySelectorAll('[data-tab]');
const login = document.querySelector('#loginForm');
const register = document.querySelector('#registerForm');
const errorBox = document.querySelector('#authError');
const claimAssessmentId = qs('claimAssessmentId');
const claimToken = qs('claimToken');
const requestedNext = qs('next') || '/dashboard.html';
const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard.html';

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((x) => x.classList.toggle('active', x === tab));
  login.hidden = tab.dataset.tab !== 'login';
  register.hidden = tab.dataset.tab !== 'register';
  hideError(errorBox);
}));

login.addEventListener('submit', (event) => submit(event, '/api/auth/login', {
  email: document.querySelector('#loginEmail').value,
  password: document.querySelector('#loginPassword').value,
}));

register.addEventListener('submit', (event) => submit(event, '/api/auth/register', {
  email: document.querySelector('#registerEmail').value,
  password: document.querySelector('#registerPassword').value,
  termsAccepted: document.querySelector('#termsAccepted').checked,
}));

async function submit(event, endpoint, fields) {
  event.preventDefault();
  hideError(errorBox);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Please wait…');
  try {
    await api(endpoint, { method: 'POST', body: JSON.stringify({ ...fields, claimAssessmentId, claimToken }) });
    location.href = next;
  } catch (error) {
    showError(errorBox, error.message);
    setBusy(button, false);
  }
}

api('/api/auth/me').then(({ user }) => { if (user) location.href = next; }).catch(() => null);
