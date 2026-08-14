import { api, escapeHtml, hideError, qs, setBusy, showError } from './shared.js';
import { buildRevisionQuestionFlow } from './assessment-revision.js';

const form = document.querySelector('#assessmentForm');
const profileStep = document.querySelector('#profileStep');
const questionStage = document.querySelector('#questionStage');
const errorBox = document.querySelector('#formError');
const progressBar = document.querySelector('#progressBar');
const progressText = document.querySelector('#progressText');
const progressLabel = document.querySelector('#progressLabel');
const backButton = document.querySelector('#backButton');
const nextButton = document.querySelector('#nextButton');
const submitButton = document.querySelector('#submitAssessment');
const evidenceSelect = document.querySelector('#questionEvidence');
const agentName = document.querySelector('#agentName');
const agentType = document.querySelector('#agentType');
const agentDescription = document.querySelector('#agentDescription');
const revisionNotice = document.querySelector('#revisionNotice');
const revisionReviewField = document.querySelector('#revisionReviewField');
const reviewPreviousAnswers = document.querySelector('#reviewPreviousAnswers');
const revisionQuestionNav = document.querySelector('#revisionQuestionNav');
const revisionQuestionList = document.querySelector('#revisionQuestionList');
const updateFrom = qs('updateFrom');
const updateToken = qs('token');

let questionnaire = [];
let flowQuestions = [];
let evidenceOptions = [];
let stepIndex = 0;
let sourceAssessmentId = '';
let revisionSourceName = '';
const answers = new Map();

async function init() {
  try {
    const revisionRequest = updateFrom
      ? api(`/api/assessments/${encodeURIComponent(updateFrom)}${updateToken ? `?token=${encodeURIComponent(updateToken)}` : ''}`)
      : Promise.resolve(null);
    const [questionPayload, cfg, revisionPayload] = await Promise.all([
      api('/api/questionnaire'),
      api('/api/config'),
      revisionRequest,
    ]);
    questionnaire = questionPayload.questionnaire;
    flowQuestions = questionnaire;
    evidenceOptions = questionPayload.evidenceOptions || [];
    if (cfg.demoMode) {
      const demoNotice = document.querySelector('#demoNotice');
      demoNotice.textContent = 'Demo mode is active. Paid checkout will be simulated; no card is charged.';
      demoNotice.hidden = false;
    }
    if (updateFrom) {
      if (!revisionPayload?.revisionSource) throw new Error('This assessment cannot be used as an update source. Sign in as its owner and try again.');
      applyRevisionSource(revisionPayload.revisionSource);
    } else {
      const preset = qs('type');
      if (preset) agentType.value = preset;
    }
    updateDescriptionRequirement();
    renderStep();
  } catch (error) {
    showError(errorBox, error.message);
    nextButton.disabled = true;
  }
}

function normaliseSourceAnswer(question, raw) {
  const candidate = typeof raw === 'string'
    ? { value: raw, evidence: 'customer_assertion' }
    : { value: raw?.value, evidence: raw?.evidence || 'none' };
  if (!question.options.some((option) => option.value === candidate.value)) return null;
  const allowedEvidence = new Set(['none', 'customer_assertion', 'evidence_ready']);
  const evidence = candidate.value === 'unknown'
    ? 'none'
    : allowedEvidence.has(candidate.evidence) ? candidate.evidence : 'customer_assertion';
  return { value: candidate.value, evidence };
}

function refreshRevisionFlow() {
  if (!sourceAssessmentId) return;
  const reviewAll = Boolean(reviewPreviousAnswers?.checked);
  const unresolvedCount = questionnaire.filter((question) => !answers.has(question.id) || answers.get(question.id)?.value === 'unknown').length;
  flowQuestions = buildRevisionQuestionFlow(questionnaire, answers, reviewAll);

  if (reviewAll || unresolvedCount === 0) {
    revisionNotice.textContent = `Creating an updated assessment from ${revisionSourceName}. Previous answers are prefilled for review and can be changed in this new assessment. The previous assessment remains unchanged.`;
  } else {
    revisionNotice.textContent = `Creating an updated assessment from ${revisionSourceName}. Previous known answers are prefilled; by default, only unresolved questions need a new answer. Turn on “Review all previous answers” if new information changes an earlier answer. The previous assessment remains unchanged.`;
  }
}

function applyRevisionSource(source) {
  sourceAssessmentId = source.assessmentId;
  revisionSourceName = source.name || 'the previous assessment';
  agentName.value = source.name || '';
  agentType.value = source.agentType || '';
  const sourceAnswers = source.answers && typeof source.answers === 'object' ? source.answers : {};
  agentDescription.value = String(sourceAnswers.__system_description || '').slice(0, 800);
  answers.clear();
  for (const question of questionnaire) {
    const answer = normaliseSourceAnswer(question, sourceAnswers[question.id]);
    if (answer) answers.set(question.id, answer);
  }
  if (revisionReviewField) revisionReviewField.hidden = false;
  if (reviewPreviousAnswers) reviewPreviousAnswers.checked = false;
  refreshRevisionFlow();
  revisionNotice.hidden = false;
}

function answerSummary(question) {
  const saved = answers.get(question.id);
  const option = question.options.find((item) => item.value === saved?.value);
  return option?.label || 'Information required';
}

function renderRevisionQuestionNav() {
  if (!sourceAssessmentId || !revisionQuestionNav || !revisionQuestionList) return;
  revisionQuestionNav.hidden = false;
  revisionQuestionList.innerHTML = flowQuestions.map((question, index) => `
    <button class="revision-question-link ${stepIndex === index + 1 ? 'active' : ''}" data-question-index="${index + 1}" type="button">
      <span>${index + 2}. ${escapeHtml(question.domain)}</span>
      <strong>${escapeHtml(question.title)}</strong>
      <small>${escapeHtml(answerSummary(question))}</small>
    </button>`).join('');
}

function updateDescriptionRequirement() {
  const required = agentType.value === 'Other';
  agentDescription.required = required;
  agentDescription.setAttribute('aria-required', String(required));
  agentDescription.placeholder = required
    ? 'Describe the agent’s purpose, users, main capabilities and anything unusual about its architecture.'
    : 'Example: General autonomous system with long-term planning and cross-session learning. It currently runs in a manual testing UI.';
}

function plainEvidenceLabel(option) {
  if (option.value === 'none') return 'No proof yet';
  if (option.value === 'customer_assertion') return 'My answer only (not verified)';
  if (option.value === 'evidence_ready') return 'I have supporting evidence to attach (not verified yet)';
  return option.label;
}

function renderStep() {
  hideError(errorBox);
  const totalSteps = flowQuestions.length + 1;
  const currentStep = stepIndex + 1;
  const percent = flowQuestions.length ? Math.round((stepIndex / flowQuestions.length) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  backButton.hidden = stepIndex === 0;
  renderRevisionQuestionNav();

  if (stepIndex === 0) {
    profileStep.hidden = false;
    questionStage.hidden = true;
    progressLabel.textContent = `Step 1 of ${totalSteps}`;
    nextButton.hidden = false;
    submitButton.hidden = true;
    updateDescriptionRequirement();
    return;
  }

  profileStep.hidden = true;
  questionStage.hidden = false;
  const question = flowQuestions[stepIndex - 1];
  const saved = answers.get(question.id);
  document.querySelector('#questionKind').textContent = question.kind === 'exposure' ? 'What could happen?' : 'What protection is in place?';
  document.querySelector('#stepCount').textContent = `Step ${currentStep} of ${totalSteps}`;
  document.querySelector('#questionDomain').textContent = question.domain;
  document.querySelector('#questionTitle').textContent = question.title;
  document.querySelector('#questionHelp').textContent = question.help;
  document.querySelector('#questionOptions').innerHTML = question.options.map((option) => `
    <label class="guided-option ${option.value === 'unknown' ? 'not-sure' : ''}">
      <input type="radio" name="currentQuestion" value="${escapeHtml(option.value)}" ${saved?.value === option.value ? 'checked' : ''}>
      <span>${escapeHtml(option.label)}</span>
    </label>`).join('');

  evidenceSelect.innerHTML = evidenceOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(plainEvidenceLabel(option))}</option>`).join('');
  evidenceSelect.value = saved?.evidence || 'customer_assertion';
  progressLabel.textContent = `${question.domain} · step ${currentStep} of ${totalSteps}`;
  const last = stepIndex === flowQuestions.length;
  nextButton.hidden = last;
  submitButton.hidden = !last && !sourceAssessmentId;
  submitButton.textContent = sourceAssessmentId ? 'Save updated result' : 'Show my result';
  questionStage.focus?.();
}

function validateProfile() {
  const name = document.querySelector('#agentName').value.trim();
  const type = agentType.value;
  const description = agentDescription.value.trim();
  if (!name) {
    showError(errorBox, 'Give the agent a name so you can recognise this result later.');
    document.querySelector('#agentName').focus();
    return false;
  }
  if (!type) {
    showError(errorBox, 'Choose the closest description of what the agent does.');
    agentType.focus();
    return false;
  }
  if (type === 'Other' && description.length < 10) {
    showError(errorBox, 'Describe what this agent does so the assessment does not lose important context.');
    agentDescription.focus();
    return false;
  }
  return true;
}

function saveCurrentQuestion() {
  const question = flowQuestions[stepIndex - 1];
  const selected = form.querySelector('input[name="currentQuestion"]:checked');
  if (!selected) {
    showError(errorBox, 'Choose the closest answer, or select “I’m not sure”.');
    return false;
  }
  const evidence = selected.value === 'unknown' ? 'none' : evidenceSelect.value || 'customer_assertion';
  answers.set(question.id, { value: selected.value, evidence });
  return true;
}

agentType.addEventListener('change', updateDescriptionRequirement);
reviewPreviousAnswers?.addEventListener('change', () => {
  if (!sourceAssessmentId || stepIndex !== 0) return;
  refreshRevisionFlow();
  renderStep();
});

revisionQuestionList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-question-index]');
  if (!button || !sourceAssessmentId) return;
  hideError(errorBox);
  if (stepIndex === 0 && !validateProfile()) return;
  if (stepIndex > 0) {
    const selected = form.querySelector('input[name="currentQuestion"]:checked');
    if (selected && !saveCurrentQuestion()) return;
  }
  const targetIndex = Number(button.dataset.questionIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 1 || targetIndex > flowQuestions.length) return;
  stepIndex = targetIndex;
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

nextButton.addEventListener('click', () => {
  hideError(errorBox);
  if (stepIndex === 0 && !validateProfile()) return;
  if (stepIndex > 0 && !saveCurrentQuestion()) return;
  if (stepIndex < flowQuestions.length) {
    stepIndex += 1;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

backButton.addEventListener('click', () => {
  hideError(errorBox);
  if (stepIndex > 0) {
    if (stepIndex <= flowQuestions.length) {
      const selected = form.querySelector('input[name="currentQuestion"]:checked');
      if (selected) saveCurrentQuestion();
    }
    stepIndex -= 1;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError(errorBox);
  if (stepIndex > 0 && !saveCurrentQuestion()) return;
  if (!sourceAssessmentId && stepIndex !== flowQuestions.length) return;
  if (!validateProfile()) {
    stepIndex = 0;
    renderStep();
    return;
  }
  const payloadAnswers = Object.fromEntries(questionnaire.map((question) => [question.id, answers.get(question.id)]));
  const description = agentDescription.value.trim();
  if (description) payloadAnswers.__system_description = description.slice(0, 800);
  setBusy(submitButton, true, 'Building your result…');
  try {
    const payload = await api('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({
        name: agentName.value.trim(),
        agentType: agentType.value,
        answers: payloadAnswers,
        sourceAssessmentId: sourceAssessmentId || undefined,
        sourceAccessToken: sourceAssessmentId ? updateToken || undefined : undefined,
      }),
    });
    sessionStorage.setItem('arl_last_assessment', JSON.stringify({ id: payload.assessment.id, token: payload.accessToken }));
    location.href = `/result.html?id=${encodeURIComponent(payload.assessment.id)}&token=${encodeURIComponent(payload.accessToken)}`;
  } catch (error) {
    showError(errorBox, error.message);
    setBusy(submitButton, false);
  }
});

init();
