import { api, escapeHtml, setBusy } from './shared.js';

const TARGET_MARKER = '[ARL_TARGET]';
let activeAssessmentId = '';
let activeTarget = null;
let loadSerial = 0;
let hostedRunBusy = false;

function parseTarget(text = '') {
  const value = String(text || '');
  const markerIndex = value.indexOf(TARGET_MARKER);
  if (markerIndex < 0) return null;
  const targetText = value.slice(markerIndex + TARGET_MARKER.length);
  const repository = targetText.match(/Repository:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const revision = targetText.match(/Revision:\s*([a-f0-9]{40})/i)?.[1]?.toLowerCase() || '';
  return repository && revision ? { repository, revision } : null;
}

function selectedAssessmentId() {
  const selected = document.querySelector('#assessmentSelect')?.value;
  return selected || new URLSearchParams(location.search).get('assessment') || sessionStorage.getItem('arl_selected_assessment') || '';
}

function targetFromAssessment(assessment = {}) {
  return parseTarget(assessment?.result?.systemDescription || assessment?.systemDescription || assessment?.answers?.__system_description || '');
}

function targetPanelHtml(target) {
  if (!target) {
    return `<section class="workspace-section section-gap" data-inspector-target-panel>
      <span class="eyebrow">Assessment target</span>
      <h2>No frozen repository revision is recorded for this assessment</h2>
      <p>Source evidence can still be collected locally, but AgentRiskLayer cannot prove that the scan came from the same source revision used when this assessment was created.</p>
      <p class="microcopy">The revision identity remains a limitation. Create an updated assessment with a GitHub repository and full commit SHA before relying on exact source-to-retest continuity.</p>
    </section>`;
  }
  return `<section class="workspace-section section-gap" data-inspector-target-panel>
    <div class="workspace-section-heading"><div><span class="eyebrow">Frozen assessment target</span><h2>${escapeHtml(target.repository)}</h2><p><strong>Revision</strong><br><code>${escapeHtml(target.revision)}</code></p></div><span class="evidence-chip">Exact revision</span></div>
    <div class="success-box"><strong>Source evidence stays tied to this commit.</strong><p>AgentRiskLayer will fail closed if GitHub does not resolve the exact frozen SHA. A later commit is a new assessment revision.</p></div>
    <div class="source-method-grid" data-source-methods>
      <article class="workspace-status-card" data-state="verified">
        <small>Recommended</small>
        <strong>GitHub source</strong>
        <p>AgentRiskLayer fetches this public repository at the exact frozen commit, runs the read-only Inspector server-side, records only evidence metadata, then deletes the temporary source archive.</p>
        <button class="button primary small" id="runGithubSource">Inspect frozen GitHub revision</button>
        <p class="microcopy">Run source evidence for this exact revision. No terminal command is required. This is static source evidence, not runtime proof.</p>
      </article>
      <article class="workspace-status-card" data-state="unresolved">
        <small>Fallback</small>
        <strong>Local source</strong>
        <p>Use the local Inspector when the repository is private, offline, or source custody must remain on your machine. The same assessment and frozen SHA are preserved.</p>
        <button class="button ghost small" id="useLocalSource">Use local Inspector</button>
        <p class="microcopy">The local command verifies <code>git rev-parse HEAD</code> before scanning. A different commit fails closed.</p>
      </article>
    </div>
    <div class="notice" id="githubSourceStatus" hidden></div>
  </section>`;
}

function renderTargetPanel() {
  const command = document.querySelector('.workspace-agent-command');
  if (!command) return;
  document.querySelector('[data-inspector-target-panel]')?.remove();
  command.insertAdjacentHTML('afterend', targetPanelHtml(activeTarget));
  const nextAction = command.querySelector('.workspace-next-action');
  const localButton = document.querySelector('#createToken');
  if (activeTarget && nextAction) {
    const strong = nextAction.querySelector('strong');
    const paragraph = nextAction.querySelector('p');
    if (strong) strong.textContent = 'Choose how to collect source evidence.';
    if (paragraph) paragraph.textContent = 'GitHub is recommended for this frozen public target. Local inspection remains available as a fallback.';
    if (localButton) localButton.hidden = true;
  } else if (localButton) {
    localButton.hidden = false;
  }
  document.querySelector('#runGithubSource')?.addEventListener('click', runGithubSource);
  document.querySelector('#useLocalSource')?.addEventListener('click', () => {
    if (!localButton) return;
    localButton.hidden = false;
    localButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    localButton.focus();
  });
}

async function runGithubSource(event) {
  if (!activeAssessmentId || !activeTarget || hostedRunBusy) return;
  const button = event.currentTarget;
  const status = document.querySelector('#githubSourceStatus');
  hostedRunBusy = true;
  setBusy(button, true, 'Inspecting frozen revision…');
  if (status) {
    status.hidden = false;
    status.className = 'notice';
    status.innerHTML = '<strong>Collecting observed source evidence…</strong> AgentRiskLayer is verifying the exact GitHub commit and running the read-only Inspector. This can take a moment.';
  }
  try {
    const result = await api('/api/inspector/github', {
      method: 'POST',
      body: JSON.stringify({ assessmentId: activeAssessmentId }),
    });
    if (status) {
      status.className = 'success-box';
      status.innerHTML = `<strong>GitHub source evidence recorded.</strong><p>${escapeHtml(activeTarget.repository)} @ <code>${escapeHtml(activeTarget.revision)}</code> is now linked to this assessment as observed static evidence.</p>`;
    }
    document.querySelector('#refreshScans')?.click();
    document.dispatchEvent(new CustomEvent('arl:source-evidence-recorded', { detail: { assessmentId: activeAssessmentId, inspectionId: result.inspection?.id || '' } }));
  } catch (error) {
    if (status) {
      status.className = 'error-box show';
      status.textContent = error.message;
    } else {
      alert(error.message);
    }
  } finally {
    hostedRunBusy = false;
    setBusy(button, false);
  }
}

function revisionGate(target) {
  if (!target) return '';
  return `EXPECTED_REVISION=${target.revision}\nACTUAL_REVISION="$(git rev-parse HEAD 2>/dev/null || true)"\nif [ "$ACTUAL_REVISION" != "$EXPECTED_REVISION" ]; then\n  echo "Frozen revision mismatch: expected $EXPECTED_REVISION but found ${'$'}{ACTUAL_REVISION:-not-a-git-repository}. Inspector not started." >&2\n  exit 1\nfi\n`;
}

function enhanceCommand() {
  const pre = document.querySelector('#scanCommand');
  if (!pre || pre.dataset.frozenTargetEnhanced === 'true') return;
  pre.dataset.frozenTargetEnhanced = 'true';
  if (!activeTarget) return;
  const original = pre.textContent || '';
  pre.textContent = `${revisionGate(activeTarget)}${original}`;
  const copy = document.querySelector('#copyCommand');
  if (copy) {
    const replacement = copy.cloneNode(true);
    replacement.addEventListener('click', () => navigator.clipboard.writeText(pre.textContent || '').then(() => alert('Command copied.')));
    copy.replaceWith(replacement);
  }
  const heading = pre.closest('.workspace-section')?.querySelector('h2');
  if (heading) heading.textContent = 'Run local Inspector against the frozen revision';
}

async function loadTarget(assessmentId) {
  const serial = ++loadSerial;
  activeAssessmentId = assessmentId;
  activeTarget = null;
  if (!assessmentId) return;
  try {
    const payload = await api(`/api/assessments/${encodeURIComponent(assessmentId)}`);
    if (serial !== loadSerial || activeAssessmentId !== assessmentId) return;
    activeTarget = targetFromAssessment(payload.assessment || {});
  } catch {
    if (serial !== loadSerial || activeAssessmentId !== assessmentId) return;
    activeTarget = null;
  }
  renderTargetPanel();
  enhanceCommand();
}

function syncSelection() {
  const id = selectedAssessmentId();
  if (!id) return;
  if (id === activeAssessmentId) {
    if (!document.querySelector('[data-inspector-target-panel]')) renderTargetPanel();
    enhanceCommand();
    return;
  }
  loadTarget(id);
}

const observer = new MutationObserver(() => {
  syncSelection();
  enhanceCommand();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('change', (event) => {
  if (event.target?.id === 'assessmentSelect') {
    activeAssessmentId = '';
    activeTarget = null;
    queueMicrotask(syncSelection);
  }
});

syncSelection();
