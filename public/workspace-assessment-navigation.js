const navigation = document.querySelector('[data-primary-navigation]');

function currentAssessmentContext() {
  const params = new URLSearchParams(location.search);
  const resultId = location.pathname.endsWith('/result.html') ? params.get('id') || '' : '';
  const requested = params.get('assessment') || resultId;
  if (requested) sessionStorage.setItem('arl_selected_assessment', requested);
  return {
    assessmentId: requested || sessionStorage.getItem('arl_selected_assessment') || '',
    token: resultId && params.get('token') ? params.get('token') : '',
  };
}

function setLinkState(link, text, href) {
  if (!link) return;
  if (link.textContent !== text) link.textContent = text;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

function assessmentScopedHref(path, context, hash = '') {
  const params = new URLSearchParams({ assessment: context.assessmentId });
  if (context.token) params.set('token', context.token);
  return `${path}?${params.toString()}${hash}`;
}

function recoverDroppedFindingsContext(context) {
  if (!context.assessmentId || !location.pathname.endsWith('/control-plane.html') || location.hash !== '#remediation') return false;
  const params = new URLSearchParams(location.search);
  if (params.get('assessment') || params.get('projectId')) return false;
  location.replace(assessmentScopedHref('/control-plane.html', context, '#remediation'));
  return true;
}

function applyAssessmentNavigation() {
  if (!navigation || document.body?.dataset.shell !== 'app') return;
  const context = currentAssessmentContext();
  if (recoverDroppedFindingsContext(context)) return;

  const assessmentLink = navigation.querySelector('[data-workspace-key="assess"], a[href="/assessment.html"]');
  const findingsLink = navigation.querySelector('[data-workspace-key="findings"], a[href="/control-plane.html#remediation"]');
  const evidenceLink = navigation.querySelector('[data-workspace-key="evidence"], a[href="/inspector.html"]');

  if (!context.assessmentId) {
    setLinkState(assessmentLink, 'New assessment', '/assessment.html');
    return;
  }

  const resultParams = new URLSearchParams({ id: context.assessmentId });
  if (context.token) resultParams.set('token', context.token);
  setLinkState(assessmentLink, 'Assessment', `/result.html?${resultParams.toString()}`);
  setLinkState(findingsLink, 'Findings', assessmentScopedHref('/control-plane.html', context, '#remediation'));
  setLinkState(evidenceLink, 'Evidence', assessmentScopedHref('/inspector.html', context));
}

applyAssessmentNavigation();

if (navigation) {
  const observer = new MutationObserver(() => applyAssessmentNavigation());
  observer.observe(navigation, { childList: true, subtree: true });
}
