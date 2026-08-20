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

function clarifyExactProjectReuse(root, exact, assessment, select, button) {
  if (!exact) return false;
  const option = [...select.options].find((item) => item.value === exact.id);
  if (!option) return false;

  select.value = exact.id;
  option.textContent = option.textContent
    .replace(/\s*·\s*possible name match\s*$/i, '')
    .replace(/\s*·\s*exact name and environment match\s*$/i, '') + ' · exact name and environment match';
  button.disabled = false;
  button.textContent = 'Use matching project';

  const limit = root.querySelector('.assessment-handoff')?.querySelector('.project-limit');
  if (limit) {
    limit.innerHTML = `<strong>Exact project match found</strong><span>${String(assessment?.name || exact.name || 'This assessment')} · ${String(exact.environment || 'project')}. Reusing it does not consume a new project slot, so no unused project slot is required.</span>`;
  }
  return true;
}

function offerDedicatedAssessmentScope(root, assessment, overview, select, button) {
  const canCreate = Boolean(overview?.assessmentCases?.canCreate || assessment?.paidTier !== 'free');
  if (!canCreate) return false;

  for (const option of [...select.options]) {
    if (option.value) option.disabled = true;
  }

  const value = '__create_assessment_scope__';
  let option = [...select.options].find((item) => item.value === value);
  if (!option) {
    option = document.createElement('option');
    option.value = value;
    select.append(option);
  }
  option.disabled = false;
  option.textContent = `${String(assessment?.name || 'This assessment')} · create dedicated remediation scope`;
  select.value = value;
  button.disabled = false;
  button.textContent = 'Create matching Atlas scope';

  const help = select.closest('.field')?.querySelector('small');
  if (help) help.textContent = 'No existing project matches this assessment. Create the dedicated scope for this exact assessed agent instead.';

  const oldNotice = root.querySelector('[data-no-matching-project]');
  if (oldNotice) oldNotice.remove();

  if (!select.dataset.assessmentScopeSubmitBound) {
    select.dataset.assessmentScopeSubmitBound = 'true';
    const form = select.closest('form');
    form?.addEventListener('submit', (event) => {
      if (select.value !== value) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      root.querySelector('#createAssessmentRemediationCase')?.click();
    }, true);
  }
  return true;
}

function clarifyProjectAction(root, exact, assessment, overview) {
  const form = root.querySelector('#assessmentProjectForm');
  const select = root.querySelector('#assessmentProjectSelect');
  const button = form?.querySelector('button[type="submit"]');
  if (!form || !select || !button) return;

  if (exact && clarifyExactProjectReuse(root, exact, assessment, select, button)) return;
  if (offerDedicatedAssessmentScope(root, assessment, overview, select, button)) return;

  select.value = '';
  for (const option of [...select.options]) {
    if (option.value) option.disabled = true;
  }
  button.disabled = true;
  button.textContent = 'No matching project';

  const help = select.closest('.field')?.querySelector('small');
  if (help) help.textContent = 'Only an existing project that represents this exact assessed agent and version can be linked.';

  if (!form.querySelector('[data-no-matching-project]')) {
    const notice = document.createElement('div');
    notice.className = 'notice warning';
    notice.dataset.noMatchingProject = 'true';
    notice.innerHTML = `<strong>No matching project found</strong><span>${String(assessment?.name || 'This assessment')} cannot be linked to a different agent. Use the dedicated remediation scope when the paid assessment entitlement is available.</span>`;
    form.append(notice);
  }
}

let contextPromise = null;
async function context() {
  if (contextPromise) return contextPromise;
  const params = new URLSearchParams(location.search);
  const assessmentId = params.get('assessment') || '';
  const token = params.get('token') || '';
  if (!assessmentId) return null;
  contextPromise = (async () => {
    // Load the overview first. The server reconciles the configured ADMIN_EMAIL
    // account to the platform-superuser role during this request. Read /auth/me
    // afterwards so the UI capability reflects that authoritative identity,
    // rather than racing a stale session role against the overview request.
    const overview = await api('/api/control-plane/overview');
    const [payload, auth] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`),
      api('/api/auth/me'),
    ]);
    if (auth?.user?.role === 'superuser') {
      overview.assessmentCases = { ...(overview.assessmentCases || {}), canCreate: true };
    }
    return { overview, assessment: payload.assessment };
  })();
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
    clarifyProjectAction(root, exactAssessmentProject(state.overview, state.assessment), state.assessment, state.overview);
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
