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

function assessmentResultHref(context, hash = '') {
  const params = new URLSearchParams({ id: context.assessmentId });
  if (context.token) params.set('token', context.token);
  return `/result.html?${params.toString()}${hash}`;
}

function markAssessmentView(context) {
  if (!navigation || !context.assessmentId || !location.pathname.endsWith('/result.html')) return;
  const findings = navigation.querySelector('[data-workspace-key="findings"], a[href*="#confirmedFindings"]');
  const assessment = navigation.querySelector('[data-workspace-key="assess"], a[href^="/result.html?"]');
  const onFindings = ['#confirmedFindings', '#priorityRisks'].includes(location.hash);
  if (onFindings) {
    assessment?.removeAttribute('aria-current');
    findings?.setAttribute('aria-current', 'page');
  } else {
    findings?.removeAttribute('aria-current');
  }
}

function applyAssessmentNavigation() {
  if (!navigation || document.body?.dataset.shell !== 'app') return;
  const context = currentAssessmentContext();
  const assessmentLink = navigation.querySelector('[data-workspace-key="assess"], a[href="/assessment.html"], a[href^="/result.html?"]');
  const findingsLink = navigation.querySelector('[data-workspace-key="findings"], a[href*="#remediation"], a[href*="#confirmedFindings"]');

  if (!context.assessmentId) {
    setLinkState(assessmentLink, 'New assessment', '/assessment.html');
    return;
  }

  setLinkState(assessmentLink, 'Assessment', assessmentResultHref(context));
  setLinkState(findingsLink, 'Findings', assessmentResultHref(context, '#confirmedFindings'));
  markAssessmentView(context);
}

applyAssessmentNavigation();

if (navigation) {
  const observer = new MutationObserver(() => applyAssessmentNavigation());
  observer.observe(navigation, { childList: true, subtree: true });
}
window.addEventListener('hashchange', applyAssessmentNavigation);
