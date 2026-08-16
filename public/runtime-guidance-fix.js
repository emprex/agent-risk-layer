// Clarify the stage-three guided Runtime action without changing protection semantics.
// The project already has a connection key at this point, so "Connect my agent"
// is misleading. Keep the website terminology aligned with the destination section.

function clarifyRuntimeGuidance() {
  const card = document.querySelector('.human-next-card');
  if (!card) return;

  const heading = card.querySelector('h2');
  const button = card.querySelector('[data-open-technical="runtime"]');
  const copy = card.querySelector('.human-next-copy p');

  if (heading?.textContent?.trim() !== 'Send the first protected request' || !button) return;

  button.textContent = 'Open technical controls';
  button.setAttribute('aria-label', 'Open technical controls for Send a protected request');

  if (copy) {
    copy.textContent = 'The connection key exists. Open Technical controls, then use Developer integration to send the first protected request. If the original key was not saved, create a new connection key first.';
  }
}

clarifyRuntimeGuidance();

const observer = new MutationObserver(() => clarifyRuntimeGuidance());
observer.observe(document.documentElement, { childList: true, subtree: true });
