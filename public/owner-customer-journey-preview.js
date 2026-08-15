import { api, qs } from './shared.js';
import { assessmentRemediationHref } from './assessment-remediation.js';

const root = document.querySelector('#resultRoot');
const assessmentId = qs('id');
const token = qs('token');

if (root && assessmentId && token) init();

async function init() {
  try {
    const [payload, auth] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}?token=${encodeURIComponent(token)}`),
      api('/api/auth/me'),
    ]);
    const assessment = payload.assessment;
    if (!auth.user?.isSuperuser || assessment?.paidTier !== 'free') return;

    const findings = (assessment.topFindings || assessment.result?.topFindings || assessment.result?.findings || [])
      .filter((item) => item?.status !== 'information-required' && item?.kind !== 'information-required');
    if (!findings.length) return;

    const addPreview = () => {
      const buyButton = root.querySelector('#buyPro');
      if (!buyButton || root.querySelector('[data-owner-customer-preview]')) return false;

      const card = document.createElement('div');
      card.className = 'result-limit-note';
      card.dataset.ownerCustomerPreview = 'true';

      const title = document.createElement('strong');
      title.textContent = 'Platform-owner customer-journey test';
      const detail = document.createElement('p');
      detail.textContent = 'Preview the paid customer remediation workflow without charging the platform owner. This internal path does not grant the paid report, subscription or runtime entitlements.';
      const action = document.createElement('a');
      action.className = 'button ghost';
      action.href = assessmentRemediationHref({ assessmentId: assessment.id, isOwner: true });
      action.textContent = 'Preview paid remediation journey';

      card.append(title, detail, action);
      const purchaseDetail = buyButton.nextElementSibling;
      if (purchaseDetail?.classList.contains('microcopy')) purchaseDetail.after(card);
      else buyButton.after(card);
      return true;
    };

    if (addPreview()) return;
    const observer = new MutationObserver(() => {
      if (addPreview()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  } catch {
    // This platform-owner-only preview must never interfere with the normal customer result or checkout path.
  }
}
