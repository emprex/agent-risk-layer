import { api, escapeHtml, qs } from './shared.js';
const root = document.querySelector('#successRoot');

function continuationFor(data) {
  const purchase = data.purchase;
  if (purchase?.assessment_id) {
    const assessmentId = encodeURIComponent(purchase.assessment_id);
    return {
      href: `/control-plane.html?assessment=${assessmentId}#remediation`,
      label: 'Continue to fixes',
      title: 'Payment complete. Continue securing this agent.',
      detail: 'Your assessment and existing evidence are preserved. Continue with the same agent to assign the first fix, attach implementation evidence, run the exact retest and record accountable closure.',
      secondaryHref: `/result.html?id=${assessmentId}`,
      secondaryLabel: 'Review assessment result',
    };
  }
  return {
    href: '/dashboard.html',
    label: 'Open workspace',
    title: 'Your subscription is active.',
    detail: 'Return to your workspace to continue protecting the agents already linked to this account.',
    secondaryHref: '/assessment.html',
    secondaryLabel: 'Assess an agent',
  };
}

async function init() {
  try {
    const data = await api(`/api/checkout/status?session_id=${encodeURIComponent(qs('session_id') || '')}`);
    const item = data.purchase || data.subscription;
    if (!item) throw new Error('Payment is still being confirmed. Refresh this page in a moment.');
    const next = continuationFor(data);
    root.innerHTML = `<div class="success-box">Payment and fulfilment completed.</div><span class="eyebrow">What happens next</span><h1 class="page-title-medium">${escapeHtml(next.title)}</h1><p class="muted">${escapeHtml(next.detail)}</p><div class="button-row"><a class="button primary" href="${next.href}">${escapeHtml(next.label)}</a><a class="button ghost" href="${next.secondaryHref}">${escapeHtml(next.secondaryLabel)}</a></div><p class="microcopy">Payment unlocks the remediation workflow. A declaration is not proof, and a finding is not closed until linked implementation evidence and a bounded retest support accountable closure.</p>`;
  } catch (error) {
    root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div><p class="muted">If payment completed, your access remains bound to your account even if this confirmation page is delayed.</p><div class="button-row"><a class="button primary" href="/dashboard.html">Check my workspace</a></div>`;
  }
}
init();
