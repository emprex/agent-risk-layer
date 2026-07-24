import { api, escapeHtml, qs } from './shared.js';
const root = document.querySelector('#verifyStatus');
const token = qs('token');
(async () => {
  if (!token) { root.className = 'error-box show'; root.textContent = 'The verification token is missing.'; return; }
  try {
    await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
    root.className = 'success-box';
    root.innerHTML = '<strong>Email verified.</strong><p>You can now purchase reports and run authorised inspection and red-team workflows.</p>';
  } catch (error) {
    root.className = 'error-box show';
    root.innerHTML = escapeHtml(error.message);
  }
})();
