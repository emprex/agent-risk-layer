import { api, hideError, qs, setBusy, showError } from './shared.js';
const token = qs('token');
const requestForm = document.querySelector('#requestForm');
const confirmForm = document.querySelector('#confirmForm');
const errorBox = document.querySelector('#resetError');
const successBox = document.querySelector('#resetSuccess');

if (token) {
  requestForm.hidden = true;
  confirmForm.hidden = false;
  document.querySelector('#resetTitle').textContent = 'Choose a new password.';
  document.querySelector('#resetIntro').textContent = 'This secure link can be used once.';
}

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault(); hideError(errorBox); successBox.hidden = true;
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Sending…');
  try {
    const result = await api('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: document.querySelector('#resetEmail').value }) });
    successBox.innerHTML = `${result.message}${result.demoResetUrl ? `<br><br><a class="button ghost small" href="${result.demoResetUrl}">Open demo reset link</a>` : ''}`;
    successBox.hidden = false;
    requestForm.reset();
  } catch (error) { showError(errorBox, error.message); }
  setBusy(button, false);
});

confirmForm.addEventListener('submit', async (event) => {
  event.preventDefault(); hideError(errorBox); successBox.hidden = true;
  const password = document.querySelector('#newPassword').value;
  const confirm = document.querySelector('#confirmPassword').value;
  if (password !== confirm) return showError(errorBox, 'The passwords do not match.');
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Updating…');
  try {
    await api('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) });
    successBox.innerHTML = 'Password updated. <a href="/auth.html">Sign in with your new password</a>.';
    successBox.hidden = false;
    confirmForm.hidden = true;
  } catch (error) { showError(errorBox, error.message); setBusy(button, false); }
});
