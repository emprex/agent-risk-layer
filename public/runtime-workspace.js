const root = document.querySelector('#controlPlaneRoot');

function currentTechnicalDecisionPanel() {
  return [...document.querySelectorAll('#technicalControls article.panel')]
    .find((panel) => panel.querySelector('h3')?.textContent?.trim() === 'Technical decision evidence') || null;
}

function syncRuntimeWorkspace() {
  const technical = document.querySelector('#technicalControls');
  document.body.classList.toggle('runtime-specialist-active', Boolean(technical));
  if (!technical) return;

  const decisionPanel = currentTechnicalDecisionPanel();
  if (decisionPanel && !decisionPanel.id) decisionPanel.id = 'decisionEvidence';

  const commandHeader = technical.querySelector('.project-command-header');
  if (commandHeader && !commandHeader.querySelector('[data-runtime-guided-back]')) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'button ghost small runtime-guided-back';
    back.dataset.runtimeGuidedBack = 'true';
    back.textContent = 'Back to simple runtime view';
    back.addEventListener('click', () => {
      const existingToggle = document.querySelector('#toggleTechnicalMode');
      if (existingToggle) {
        existingToggle.click();
      } else {
        sessionStorage.setItem('arl_control_plane_mode', 'guided');
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        location.reload();
      }
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    });
    commandHeader.append(back);
  }
}

function focusDecisionEvidence() {
  requestAnimationFrame(() => {
    syncRuntimeWorkspace();
    const decisionPanel = document.querySelector('#decisionEvidence') || currentTechnicalDecisionPanel();
    if (!decisionPanel) return;
    if (!decisionPanel.id) decisionPanel.id = 'decisionEvidence';
    history.replaceState(null, '', '#decisionEvidence');
    decisionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

if (root) {
  new MutationObserver(syncRuntimeWorkspace).observe(root, { childList: true, subtree: true });
  syncRuntimeWorkspace();
}

document.addEventListener('click', (event) => {
  const evidenceButton = event.target.closest('.plain-activity [data-open-technical="runtime"]');
  if (evidenceButton) setTimeout(focusDecisionEvidence, 0);
});

if (location.hash === '#decisionEvidence') {
  setTimeout(focusDecisionEvidence, 0);
}
