function assessmentEvidenceHref() {
  const params = new URLSearchParams(location.search);
  const assessmentId = params.get('assessment') || '';
  const token = params.get('token') || '';
  const query = new URLSearchParams();
  if (assessmentId) query.set('assessment', assessmentId);
  if (token) query.set('token', token);
  return `/inspector.html${query.toString() ? `?${query.toString()}` : ''}`;
}

export function verificationGateCopy(count) {
  const total = Number(count) || 0;
  return {
    eyebrow: 'Verify before fixing',
    title: total === 1 ? 'Verify this assessment concern first' : `Verify these ${total} assessment concerns first`,
    body: 'These items came from assessment answers. They are not confirmed findings yet, so AgentRiskLayer will not create remediation fixes until observed or reproducible evidence supports a failure.',
    action: 'Go to Evidence and verify',
  };
}

function concernCount(root) {
  const scope = root?.querySelector('.assessment-scope-banner');
  const match = scope?.textContent?.match(/\b0\s+of\s+(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

function applyGate(root) {
  if (!root) return false;
  const planning = root.querySelector('.remediation-plan-card');
  if (!planning || planning.dataset.verificationGate === 'true') return false;

  // Conservative production gate: only intercept a fresh assessment handoff
  // before any remediation item has been assigned. Core control-plane renders
  // can replace this subtree, so the observer below intentionally remains
  // active and reapplies the gate to newly rendered markup.
  const scope = root.querySelector('.assessment-scope-banner');
  if (!scope || !/\b0\s+of\s+\d+\b/i.test(scope.textContent || '')) return false;

  const count = concernCount(root);
  if (!count) return false;
  const copy = verificationGateCopy(count);
  planning.dataset.verificationGate = 'true';
  planning.innerHTML = `
    <span class="eyebrow">${copy.eyebrow}</span>
    <h3>${copy.title}</h3>
    <p>${copy.body}</p>
    <div class="notice"><strong>Next action</strong><br>Collect observed evidence or run a bounded test. Only a supported failure becomes eligible for remediation.</div>
    <a class="button primary" href="${assessmentEvidenceHref()}">${copy.action}</a>`;

  const heading = root.querySelector('#remediation .section-heading');
  const headingEyebrow = heading?.querySelector('.eyebrow');
  const headingTitle = heading?.querySelector('h2');
  const headingText = heading?.querySelector('p');
  if (headingEyebrow) headingEyebrow.textContent = 'Verify, then fix';
  if (headingTitle) headingTitle.textContent = 'Establish the finding before remediation.';
  if (headingText) headingText.textContent = 'Assessment answers identify concerns. Evidence establishes whether a weakness is real; only confirmed findings should become fixes.';

  const labels = [...scope.querySelectorAll('span, small')];
  for (const node of labels) {
    if (/fixes assigned/i.test(node.textContent || '')) node.textContent = 'confirmed fixes assigned';
    if (/remaining/i.test(node.textContent || '')) node.textContent = count === 1 ? '1 concern to verify' : `${count} concerns to verify`;
  }

  const list = root.querySelector('.remediation-plan-list');
  if (list) {
    const title = list.querySelector('h3');
    const text = list.querySelector('p');
    if (title) title.textContent = 'Confirmed remediation plan';
    if (text) text.textContent = 'Confirmed findings will appear here after verification. Assessment concerns are not fixes.';
  }
  return true;
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const params = new URLSearchParams(location.search);
  if (params.get('assessment')) {
    const root = document.querySelector('#controlPlaneRoot');
    if (root) {
      applyGate(root);
      let queued = false;
      const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          applyGate(root);
        });
      });
      observer.observe(root, { childList: true, subtree: true });
    }
  }
}
