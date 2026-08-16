// Clarify the stage-three guided Runtime action without changing protection semantics.
// The project already has a connection key at this point, so "Connect my agent"
// is misleading. Keep the website terminology aligned with the destination section.

function findDeveloperIntegration() {
  const headings = [...document.querySelectorAll('#runtime article.panel h3')];
  const heading = headings.find((item) => item.textContent?.trim() === 'Developer integration');
  const panel = heading?.closest('article.panel');
  if (panel && !panel.id) panel.id = 'developerIntegration';
  return panel || null;
}

function scrollToDeveloperIntegration() {
  let attempts = 0;
  const tryScroll = () => {
    attempts += 1;
    const panel = findDeveloperIntegration();
    if (panel) {
      history.replaceState(null, '', '#developerIntegration');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (attempts < 30) window.setTimeout(tryScroll, 100);
  };
  window.setTimeout(tryScroll, 0);
}

function clarifyRuntimeGuidance() {
  const card = document.querySelector('.human-next-card');
  if (!card) return false;

  const heading = card.querySelector('h2');
  const button = card.querySelector('[data-open-technical="runtime"]');
  const copy = card.querySelector('.human-next-copy p');

  if (heading?.textContent?.trim() !== 'Send the first protected request' || !button) return false;

  const buttonLabel = 'Open technical controls';
  const ariaLabel = 'Open technical controls for Send a protected request';
  const guidance = 'The connection key exists. Open Technical controls, then use Developer integration to send the first protected request. If the original key was not saved, create a new connection key first.';

  if (button.textContent !== buttonLabel) button.textContent = buttonLabel;
  if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel);
  if (copy && copy.textContent !== guidance) copy.textContent = guidance;
  if (button.dataset.developerIntegrationBound !== 'true') {
    button.dataset.developerIntegrationBound = 'true';
    button.addEventListener('click', scrollToDeveloperIntegration);
  }

  return true;
}

// The main Runtime module renders after its API calls complete. Poll briefly for
// the guided card instead of observing DOM mutations. This keeps the helper
// bounded and prevents the page-unresponsive failure fixed earlier.
if (!clarifyRuntimeGuidance()) {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (clarifyRuntimeGuidance() || attempts >= 50) window.clearInterval(timer);
  }, 100);
}
