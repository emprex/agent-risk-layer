// Prevent the Runtime UI from offering an impossible remediation transition.
// A remediation may move from ready_for_retest -> retested only after the Guard
// has consumed the bound criteria and the server reports a passed retest.
(() => {
  function safeText(value) { return String(value ?? '').trim(); }

  function remediationRow(select) {
    return select.closest('[data-remediation-id]');
  }

  function passedRetestRecorded(row) {
    if (!row) return false;
    const text = safeText(row.textContent).toLowerCase();
    return /retest result:\s*passed\b/.test(text);
  }

  function persistentPanel() {
    return document.getElementById('arlPersistentBoundRetest')
      || document.querySelector('[data-bound-retest-guidance]');
  }

  function showRunFirstMessage(select) {
    const row = remediationRow(select);
    let notice = row?.querySelector('[data-retest-gate-message]');
    if (!notice && row) {
      notice = document.createElement('div');
      notice.dataset.retestGateMessage = '';
      notice.className = 'notice warning';
      const detail = row.querySelector('.remediation-detail') || row;
      detail.prepend(notice);
    }
    if (notice) {
      notice.innerHTML = '<strong>Run the bound retest first.</strong><p>“Record retest” is only available after the Guard response contains <code>"retest":{"result":"passed"}</code>. Use <strong>Copy bound retest command</strong>, run it once, then this step will unlock.</p>';
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const panel = persistentPanel();
    if (panel) {
      panel.classList.add('retest-action-required');
      window.setTimeout(() => panel.classList.remove('retest-action-required'), 1800);
    }
  }

  // Capture before control-plane.js handles the lifecycle selection. This preserves
  // the backend gate and avoids presenting a server exception as a customer action.
  document.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-remediation-status]');
    if (!select || select.value !== 'retested') return;
    if (passedRetestRecorded(remediationRow(select))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    select.value = '';
    showRunFirstMessage(select);
  }, true);

  // Clarify the required order anywhere an active bound retest panel exists.
  function clarifyPanel() {
    const panel = persistentPanel();
    if (!panel || panel.querySelector('[data-retest-required-order]')) return;
    const note = document.createElement('p');
    note.dataset.retestRequiredOrder = '';
    note.innerHTML = '<strong>Required order:</strong> 1) copy and run this bound command; 2) confirm the Guard response says <code>retest.result = passed</code>; 3) only then choose <strong>Record retest</strong>.';
    const button = panel.querySelector('[data-copy-bound-retest]');
    if (button) button.insertAdjacentElement('beforebegin', note);
    else panel.append(note);
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    clarifyPanel();
    if (attempts >= 80) window.clearInterval(timer);
  }, 250);
  window.addEventListener('focus', clarifyPanel);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clarifyPanel(); });
})();
