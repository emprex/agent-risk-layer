// Hotfix shim for customer guidance render-loop regression.
// It does not write application state. It only prevents repeated DOM decoration from spinning the page.

const target = document.querySelector('#ciControlRoot, #ciRoot');
if (target) {
  let scheduled = false;
  let running = false;
  const stabilise = () => {
    if (running) return;
    running = true;
    try {
      const select = target.querySelector('#testResult');
      const button = target.querySelector('#testForm button[type="submit"]');
      if (select) {
        const planned = [...select.options].find((option) => option.value === 'planned');
        if (planned && planned.textContent !== 'Plan only — not executed') planned.textContent = 'Plan only — not executed';
      }
      if (select && button) {
        const wanted = select.value === 'planned'
          ? 'Save test plan — no evidence yet'
          : select.value
            ? 'Save executed test result'
            : target.querySelector('.ci-proof-strip')
              ? 'Record executed result'
              : 'Choose test status';
        if (button.textContent !== wanted) button.textContent = wanted;
      }
    } finally {
      running = false;
      scheduled = false;
    }
  };
  const observer = new MutationObserver(() => {
    if (scheduled || running) return;
    scheduled = true;
    queueMicrotask(stabilise);
  });
  observer.observe(target, { childList: true, subtree: true });
  stabilise();
}
