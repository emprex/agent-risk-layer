import { api } from './shared.js';
import { ASSESSMENT_FIX_CONTROLS } from './assessment-fix-controls.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';
let assessment = null;
let scheduled = false;

const byWeakness = new Map(Object.values(ASSESSMENT_FIX_CONTROLS).map((item) => [String(item.weakness || '').trim().toLowerCase(), item]));

function findingById(id) {
  return (assessment?.result?.findings || []).find((item) => item.id === id) || null;
}

function controlForFinding(finding) {
  if (!finding) return null;
  return byWeakness.get(String(finding.title || '').trim().toLowerCase()) || null;
}

function findingIdForRow(row) {
  const text = row?.querySelector('summary small')?.textContent || '';
  return text.match(/F-\d{2}/)?.[0] || '';
}

function correctRow(row) {
  const findingId = findingIdForRow(row);
  const finding = findingById(findingId);
  const control = controlForFinding(finding);
  if (!finding || !control) return;

  const evidenceLink = row.querySelector('a[href*="control-intelligence"]');
  if (evidenceLink) {
    const url = new URL(evidenceLink.href, location.origin);
    url.pathname = '/control-intelligence-control.html';
    url.searchParams.set('controlId', control.controlId);
    url.searchParams.set('assessment', assessmentId);
    url.searchParams.set('finding', findingId);
    const remediationId = row.dataset.remediationId || url.searchParams.get('remediation') || '';
    if (remediationId) url.searchParams.set('remediation', remediationId);
    evidenceLink.href = `${url.pathname}${url.search}`;
    evidenceLink.dataset.semanticControl = control.controlId;
  }

  const guide = row.querySelector('.implementation-playbook');
  if (guide && !guide.querySelector('[data-semantic-binding-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.semanticBindingNote = 'true';
    note.innerHTML = `<strong>Exact control for this finding</strong><span>${control.controlId} · ${control.label}. This binding comes from the finding question, not its display number.</span>`;
    guide.prepend(note);
  }
}

function correctWorkspace() {
  if (!assessmentId || !assessment) return;
  document.querySelectorAll('.assessment-only-remediation .remediation-row').forEach(correctRow);
  const workspace = document.querySelector('.assessment-remediation-workspace');
  if (workspace && !workspace.querySelector('[data-assessment-proof-rule]')) {
    const banner = document.createElement('section');
    banner.className = 'panel';
    banner.dataset.assessmentProofRule = 'true';
    banner.innerHTML = '<span class="eyebrow">Evidence rule</span><h3>The assessment is the baseline. Closure is a separate evidence decision.</h3><p>Fixes do not rewrite the original answers. Each declared finding stays historical until evidence is linked, the exact mapped control is tested again, and an accountable reviewer records closure. A passed test proves only its bounded control and scope.</p>';
    workspace.querySelector('#remediation')?.prepend(banner);
  }
}

async function init() {
  if (!assessmentId) return;
  try {
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    assessment = (await api(`/api/assessments/${encodeURIComponent(assessmentId)}${query}`)).assessment;
    correctWorkspace();
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        correctWorkspace();
      });
    });
    observer.observe(document.querySelector('#controlPlaneRoot') || document.body, { childList: true, subtree: true });
  } catch {
    // Core remediation remains available if semantic enhancement cannot load.
  }
}

void init();
