import { api } from './shared.js';
import { exactAssessmentProject, assessmentConcernCopy } from './remediation-handoff-model.js';

function replaceText(node, from, to) {
  if (!node || !node.textContent?.includes(from)) return;
  node.textContent = node.textContent.replace(from, to);
}

function clarifyConcernLanguage(root) {
  const copy = assessmentConcernCopy();
  const handoffFinding = root.querySelector('.assessment-handoff-finding');
  const label = handoffFinding?.querySelector('small');
  if (label) label.textContent = copy.label;
  if (handoffFinding && !handoffFinding.querySelector('[data-assessment-concern-explanation]')) {
    const explanation = document.createElement('p');
    explanation.className = 'microcopy muted';
    explanation.dataset.assessmentConcernExplanation = 'true';
    explanation.textContent = copy.explanation;
    handoffFinding.append(explanation);
  }

  for (const node of root.querySelectorAll('label, h3, p, small')) {
    replaceText(node, 'Declared weakness', 'Assessment concern');
    replaceText(node, 'declared weakness', 'assessment concern');
    replaceText(node, 'declared weaknesses', 'assessment concerns');
  }
}

function clarifyExactMatch(root, exact) {
  if (!exact) return;
  const select = root.querySelector('#assessmentProjectSelect');
  if (!select) return;
  const option = [...select.options].find((item) => item.value === exact.id);
  if (!option) return;

  select.value = exact.id;
  option.textContent = option.textContent
    .replace(/\s*·\s*possible name match\s*$/i, '')
    .replace(/\s*·\s*exact name and environment match\s*$/i, '') + ' · exact name and environment match';

  const button = root.querySelector('#assessmentProjectForm button[type="submit"]');
  if (button) button.textContent = 'Use matching project';

  const warning = [...root.querySelectorAll('.notice.warning')].find((node) => /no unused project slot/i.test(node.textContent || ''));
  if (warning) {
    warning.classList.remove('warning');
    warning.dataset.exactProjectReuse = 'true';
    warning.textContent = 'Matching existing project found. Reusing it does not consume a new project slot.';
  }
}

let contextPromise = null;
async function context() {
  if (contextPromise) return contextPromise;
  const params = new URLSearchParams(location.search);
  const assessmentId = params.get('assessment') || '';
  const token = params.get('token') || '';
  if (!assessmentId) return null;
  contextPromise = Promise.all([
    api('/api/control-plane/overview'),
    api(`/api/assessments/${encodeURIComponent(assessmentId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`),
  ]).then(([overview, payload]) => ({ overview, assessment: payload.assessment }));
  return contextPromise;
}

let decorated = false;
async function decorate() {
  if (decorated) return;
  const root = document.querySelector('#controlPlaneRoot');
  const handoff = root?.querySelector('.assessment-handoff');
  if (!root || !handoff) return;

  decorated = true;
  try {
    clarifyConcernLanguage(root);
    const state = await context();
    if (!state) return;
    clarifyExactMatch(root, exactAssessmentProject(state.overview, state.assessment));
  } catch {
    // This layer only clarifies handoff copy. The primary remediation workflow remains usable if it cannot load.
  }
}

function startWhenHandoffExists() {
  const root = document.querySelector('#controlPlaneRoot');
  if (!root) return;

  if (root.querySelector('.assessment-handoff')) {
    decorate();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!root.querySelector('.assessment-handoff')) return;
    observer.disconnect();
    decorate();
  });
  observer.observe(root, { childList: true, subtree: true });
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  startWhenHandoffExists();
}
