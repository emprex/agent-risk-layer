import { api, escapeHtml } from './shared.js';

const TARGET_MARKER = '[ARL_TARGET]';
let activeAssessmentId = '';
let activeTarget = null;
let loadSerial = 0;

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
      <p>Source evidence can still be collected, but AgentRiskLayer cannot prove that the scan came from the same source revision used when this assessment was created.</p>
      <p class="microcopy">Source evidence will be attached to the assessment, but revision identity remains a limitation. Create an updated assessment with a GitHub repository and full commit SHA before relying on exact source-to-retest continuity.</p>
    </section>`;
  }
  return `<section class="workspace-section section-gap" data-inspector-target-panel>
    <span class="eyebrow">Frozen assessment target</span>
    <h2>${escapeHtml(target.repository)}</h2>
    <p><strong>Revision</strong><br><code>${escapeHtml(target.revision)}</code></p>
    <div class="success-box"><strong>Run source evidence for this exact revision.</strong><p>The generated command checks <code>git rev-parse HEAD</code> before the Inspector starts. A different commit fails closed.</p></div>
  </section>`;
}

function renderTargetPanel() {
  const command = document.querySelector('.workspace-agent-command');
  if (!command) return;
  document.querySelector('[data-inspector-target-panel]')?.remove();
  command.insertAdjacentHTML('afterend', targetPanelHtml(activeTarget));
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
  if (heading) heading.textContent = 'Run against the frozen assessed revision';
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
  if (!id || id === activeAssessmentId) {
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
