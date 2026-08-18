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
  if (link.textContent !== text) link.textContent = text;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

function applyAssessmentNavigation() {
  if (!navigation || document.body?.dataset.shell !== 'app') return;
  const context = currentAssessmentContext();
  const link = navigation.querySelector('[data-workspace-key="assess"], a[href="/assessment.html"]');
  if (!link) return;

  if (!context.assessmentId) {
    setLinkState(link, 'New assessment', '/assessment.html');
    return;
  }

  const params = new URLSearchParams({ id: context.assessmentId });
  if (context.token) params.set('token', context.token);
  setLinkState(link, 'Assessment', `/result.html?${params.toString()}`);
}

applyAssessmentNavigation();

if (navigation) {
  const observer = new MutationObserver(() => applyAssessmentNavigation());
  observer.observe(navigation, { childList: true, subtree: true });
}
