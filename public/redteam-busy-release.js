const params = new URLSearchParams(location.search);
const planId = String(params.get('plan') || '').trim();
const retestRequested = params.get('retest') === '1';

function readyLabel() {
  if (retestRequested) return 'Create exact retest command';
  if (planId) return 'Create bounded evidence command';
  return 'Create controlled campaign command';
}

function releaseCreateAction() {
  const command = document.querySelector('#campaignCommand');
  const button = document.querySelector('#createCampaign');
  if (!command || !button) return false;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  if (button.textContent.trim() === 'Creating…') button.textContent = readyLabel();
  return true;
}

const observer = new MutationObserver(() => {
  if (releaseCreateAction()) observer.disconnect();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
releaseCreateAction();
