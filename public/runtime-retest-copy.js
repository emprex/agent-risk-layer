// Reliable, inspectable copy path for remediation bound-retest commands.
// The command never contains the connection key; the terminal prompts for it.
(() => {
  const STORAGE_KEY = 'arl_runtime_retest_workflow_v1';

  function safeText(value) {
    return String(value ?? '').trim();
  }

  function loadRecord(remediationId) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {};
      return stored[remediationId] || {};
    } catch {
      return {};
    }
  }

  function exactCriteria(record) {
    const ruleId = safeText(record.ruleId).toUpperCase();
    const expectedDecision = safeText(record.expectedDecision).toLowerCase();
    const actionType = safeText(record.actionType).toLowerCase();
    const targetIdentity = safeText(record.targetIdentity).toLowerCase();
    if (!safeText(record.criteriaId) || !ruleId || !['allow', 'deny'].includes(expectedDecision)
      || !['tool', 'content.input', 'content.output'].includes(actionType) || !targetIdentity
      || record.exactCriteriaCaptured !== true) return null;
    return { ruleId, expectedDecision, actionType, targetIdentity };
  }

  function commandFor(record) {
    const criteria = exactCriteria(record);
    if (!criteria) return '';
    const requestId = `retest-${criteria.targetIdentity.replace(/[^a-z0-9._-]+/gi, '-')}-${Date.now()}`;
    const request = {
      request_id: requestId,
      retestCriteriaId: safeText(record.criteriaId),
      metadata: { application: 'agent-retest' },
    };
    if (criteria.actionType === 'tool') {
      request.input = 'Bound remediation retest. Do not execute any external action unless AgentRiskLayer allows it.';
      request.tool_call = { name: criteria.targetIdentity, arguments: { command: 'echo arl-retest' } };
    } else if (criteria.actionType === 'content.input') {
      request.input = criteria.targetIdentity;
    } else {
      request.output = criteria.targetIdentity;
    }
    const body = JSON.stringify(request, null, 2).replace(/'/g, "'\\''");
    return `read -rsp "AgentRiskLayer connection key: " ARL_KEY\necho\n\ncurl -sS https://agentrisklayer.com/v1/guard \\\n  -H "Authorization: Bearer $ARL_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'\n\nunset ARL_KEY\necho`;
  }

  function showCommand(button, command) {
    const panel = button.closest('[data-bound-retest-guidance]');
    if (!panel) return null;
    let box = panel.querySelector('[data-bound-retest-command]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.boundRetestCommand = '';
      box.style.marginTop = '0.75rem';
      box.innerHTML = '<p><strong>Bound retest command</strong> — verify it contains <code>retestCriteriaId</code> and the exact target before running it.</p><textarea readonly rows="13" spellcheck="false" style="width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical"></textarea><p data-bound-retest-copy-status class="muted"></p>';
      button.insertAdjacentElement('afterend', box);
    }
    const textarea = box.querySelector('textarea');
    textarea.value = command;
    return { box, textarea, status: box.querySelector('[data-bound-retest-copy-status]') };
  }

  function legacyCopy(textarea) {
    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }

  async function copyVisibleCommand(button) {
    const remediationId = safeText(button.dataset.copyBoundRetest);
    const record = loadRecord(remediationId);
    const command = commandFor(record);
    if (!command) return;

    const view = showCommand(button, command);
    if (!view) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = legacyCopy(view.textarea);

    if (copied) {
      view.status.textContent = 'Copied. Paste this exact command into the terminal.';
      button.textContent = 'Copied — command shown below';
    } else {
      view.textarea.focus();
      view.textarea.select();
      view.status.textContent = 'Browser clipboard access was blocked. The exact command is selected above; copy it manually.';
      button.textContent = 'Command shown below';
    }
  }

  // Capture before the older helper so a clipboard failure can never silently leave
  // an unrelated value (such as the page URL) in the clipboard.
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-copy-bound-retest]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    copyVisibleCommand(button);
  }, true);
})();
