const selectors = ['#sideEffect', '#evidenceSideEffect', '#findingSideEffect', '#retestSideEffect'];

function requireExplicitOutcome() {
  for (const selector of selectors) {
    const select = document.querySelector(`#ciControlRoot ${selector}`);
    if (!select || select.dataset.explicitOutcome === 'true') continue;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Choose what actually happened';
    select.prepend(option);
    select.value = '';
    select.required = true;
    select.setAttribute('aria-required', 'true');
    select.dataset.explicitOutcome = 'true';
  }
}

const observer = new MutationObserver(requireExplicitOutcome);
observer.observe(document.querySelector('#ciControlRoot') || document.body, { childList: true, subtree: true });
requireExplicitOutcome();
