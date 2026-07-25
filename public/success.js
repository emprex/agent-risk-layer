import { api, escapeHtml, qs } from './shared.js';
const root = document.querySelector('#successRoot');
async function init() {
  try {
    const data = await api(`/api/checkout/status?session_id=${encodeURIComponent(qs('session_id') || '')}`);
    const item = data.purchase || data.subscription;
    if (!item) throw new Error('Payment is still being confirmed. Refresh this page in a moment.');
    root.innerHTML = `<div class="success-box">Payment and fulfilment completed.</div><h1 class="page-title-medium">Your access is ready.</h1><p class="muted">${data.purchase?.assessment_id ? 'The report has been generated and email delivery has been attempted. It is also available from your dashboard.' : 'Your subscription is active and available from your dashboard.'}</p><div class="button-row"><a class="button primary" href="/dashboard.html">Open dashboard</a><a class="button ghost" href="/assessment.html">Run an assessment</a></div>`;
  } catch (error) { root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div><div class="button-row"><a class="button primary" href="/dashboard.html">Check dashboard</a></div>`; }
}
init();
