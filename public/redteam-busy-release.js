const params = new URLSearchParams(location.search);
const planId = String(params.get('plan') || '').trim();
const retestRequested = params.get('retest') === '1';
const assessmentId = String(params.get('assessment') || '').trim();
const roeStorageKey = assessmentId ? `arl_redteam_roe_${assessmentId}` : 'arl_redteam_roe';
let lastAuthorisationId = sessionStorage.getItem(roeStorageKey) || '';
let watchdog = null;

function readyLabel() {
  if (document.querySelector('#campaignCommand')) return 'Create new one-time token';
  if (retestRequested) return 'Create exact retest command';
  if (planId) return 'Create bounded evidence command';
  return 'Create controlled campaign command';
}

function adapterModeSelected() {
  return document.querySelector('input[name="mode"]:checked')?.value === 'adapter';
}

function preparationCommand() {
  return `curl -fsSLO ${location.origin}/downloads/agent-risk-redteam.mjs\ncurl -fsSLO ${location.origin}/downloads/agent-risk-redteam.mjs.sha256\nsha256sum -c agent-risk-redteam.mjs.sha256`;
}

function ensurePreparationCard() {
  const button = document.querySelector('#createCampaign');
  if (!button) return false;
  let card = document.querySelector('[data-redteam-preparation]');
  if (!card) {
    card = document.createElement('div');
    card.className = 'command-card';
    card.dataset.redteamPreparation = 'true';
    card.innerHTML = `<span class="eyebrow">Prepare once</span><h3>Prepare the runner before issuing a one-time token</h3><p class="microcopy">Do this before creating the token. The token is single-use and should be spent only on the actual target run.</p><pre>${preparationCommand()}</pre>`;
    button.insertAdjacentElement('beforebegin', card);
  }
  card.hidden = !adapterModeSelected();
  return true;
}

function normaliseGeneratedCommand(value) {
  let command = String(value || '').trim();
  if (!command) return command;
  const lines = command.split(/\n/).filter((line) => {
    const trimmed = line.trim();
    return !/^curl -fsSLO .*\/downloads\/agent-risk-redteam\.mjs(?:\.sha256)?$/.test(trimmed)
      && trimmed !== 'sha256sum -c agent-risk-redteam.mjs.sha256';
  });
  command = lines.join('\n').trim();
  command = command.replace(/^([A-Z0-9_]+)=YOUR_ADAPTER_TOKEN\s+/, '');
  if (adapterModeSelected() && !/(?:^|\s)--timeout\s+\d+\b/.test(command)) {
    command = command.replace(/\s--trials\s+/, ' --timeout 30000 --trials ');
  }
  return command;
}

function rememberAuthorisation(command) {
  const match = String(command || '').match(/--authorisation-id\s+(?:'([^']+)'|"([^"]+)"|([^\s]+))/);
  const id = match?.[1] || match?.[2] || match?.[3] || '';
  if (!id) return;
  lastAuthorisationId = id;
  sessionStorage.setItem(roeStorageKey, id);
}

function selectRememberedAuthorisation() {
  if (!lastAuthorisationId) return false;
  const select = document.querySelector('#authorisationChoice');
  if (!select) return false;
  const option = [...select.options].find((item) => item.value === lastAuthorisationId);
  if (!option) return false;
  if (select.value !== lastAuthorisationId) {
    select.value = lastAuthorisationId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function updateTokenNotice() {
  const command = document.querySelector('#campaignCommand');
  const card = command?.closest('.command-card');
  const notice = card?.querySelector('.success-box');
  if (!notice || notice.dataset.singleUseExplained === 'true') return;
  const expiry = notice.textContent.match(/expires\s+(.+?)\.?$/i)?.[1] || '';
  notice.dataset.singleUseExplained = 'true';
  notice.innerHTML = `<strong>Single-use token created.</strong> Run the command immediately. The first upload attempt consumes this token, including an error or inconclusive run.${expiry ? ` It expires ${expiry}.` : ''}`;
}

function releaseCreateAction(force = false) {
  const command = document.querySelector('#campaignCommand');
  const button = document.querySelector('#createCampaign');
  if (!button) return false;
  const creating = button.textContent.trim() === 'Creating…' || button.getAttribute('aria-busy') === 'true';
  if (!creating && !force) return false;
  if (!command && !force) return false;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  delete button.dataset.original;
  button.textContent = readyLabel();
  return true;
}

function enhanceGeneratedCommand() {
  const pre = document.querySelector('#campaignCommand');
  if (!pre) return false;
  const command = normaliseGeneratedCommand(pre.textContent);
  if (pre.textContent !== command) pre.textContent = command;
  pre.dataset.runtimeReady = 'true';
  rememberAuthorisation(command);
  updateTokenNotice();
  selectRememberedAuthorisation();
  releaseCreateAction(true);
  const button = document.querySelector('#createCampaign');
  if (button) button.textContent = 'Create new one-time token';
  return true;
}

function showCreationTimeout() {
  const button = document.querySelector('#createCampaign');
  if (!button || button.textContent.trim() !== 'Creating…' || document.querySelector('#campaignCommand')) return;
  releaseCreateAction(true);
  const box = document.querySelector('#commandBox');
  if (box && !box.querySelector('[data-create-timeout]')) {
    box.innerHTML = '<div class="error-box show" data-create-timeout>Command creation is taking too long. Your form and active Rules of Engagement are preserved. Retry without refreshing the page.</div>';
  }
}

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(showCreationTimeout, 20000);
}

function sync() {
  ensurePreparationCard();
  enhanceGeneratedCommand();
  selectRememberedAuthorisation();
  releaseCreateAction();
}

const observer = new MutationObserver(sync);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-busy'] });

document.addEventListener('change', (event) => {
  if (event.target?.matches?.('input[name="mode"]')) ensurePreparationCard();
});

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('#createCampaign');
  if (button) armWatchdog();
}, true);

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('#copyCommand');
  if (!button) return;
  const pre = document.querySelector('#campaignCommand');
  if (!pre) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const command = normaliseGeneratedCommand(pre.textContent);
  navigator.clipboard.writeText(command).then(() => {
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200);
  }).catch(() => window.alert('Clipboard access was blocked. Select and copy the command shown above.'));
}, true);

window.addEventListener('pageshow', sync);
sync();
