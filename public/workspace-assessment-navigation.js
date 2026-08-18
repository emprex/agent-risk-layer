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

function applyAssessmentNavigation() {
  if (!navigation || document.body?.dataset.shell !== 'app') return;
  const context = currentAssessmentContext();
  const link = navigation.querySelector('[data-workspace-key="assess"], a[href="/assessment.html"]');
  if (!link) return;

  if (!context.assessmentId) {
    link.textContent = 'New assessment';
    link.href = '/assessment.html';
    return;
  }

  const params = new URLSearchParams({ id: context.assessmentId });
  if (context.token) params.set('token', context.token);
  link.textContent = 'Assessment';
  link.href = `/result.html?${params.toString()}`;
}

applyAssessmentNavigation();

if (navigation) {
  const observer = new MutationObserver(() => applyAssessmentNavigation());
  observer.observe(navigation, { childList: true, subtree: true });
}
