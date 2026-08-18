import { api } from './shared.js';
import { assessmentEnvironment, assessmentProjects } from './assessment-remediation.js';

const normalise = (value) => String(value || '').trim().toLowerCase();

export function exactAssessmentProject(overview = {}, assessment = {}) {
  const name = normalise(assessment?.name);
  const environment = normalise(assessmentEnvironment(assessment));
  if (!name || !environment) return null;
  return assessmentProjects(overview).find((item) =>
    normalise(item.name) === name && normalise(item.environment || 'development') === environment) || null;
}

export function assessmentConcernCopy() {
  return {
    label: 'Assessment concern to verify',
    explanation: 'This concern comes from assessment answers. It is declared context, not a verified finding, until observed or reproducible evidence supports it.',
  };
}

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

let decorating = false;
async function decorate() {
  if (decorating) return;
  const root = document.querySelector('#controlPlaneRoot');
  if (!root) return;
  decorating = true;
  try {
    clarifyConcernLanguage(root);
    const handoff = root.querySelector('.assessment-handoff');
    if (!handoff) return;
    const state = await context();
    if (!state) return;
    clarifyExactMatch(root, exactAssessmentProject(state.overview, state.assessment));
  } catch {
    // This layer only clarifies handoff copy. The primary remediation workflow remains usable if it cannot load.
  } finally {
    decorating = false;
  }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const target = document.querySelector('#controlPlaneRoot') || document.body;
  new MutationObserver(() => decorate()).observe(target, { childList: true, subtree: true });
  decorate();
}
