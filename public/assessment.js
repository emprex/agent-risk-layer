import { api, escapeHtml, hideError, qs, setBusy, showError } from './shared.js';

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

let questionnaire = [];
let evidenceOptions = [];
let stepIndex = 0;
const answers = new Map();

async function init() {
  try {
    const [questionPayload, cfg] = await Promise.all([api('/api/questionnaire'), api('/api/config')]);
    questionnaire = questionPayload.questionnaire;
    evidenceOptions = questionPayload.evidenceOptions || [];
    if (cfg.demoMode) {
      const demoNotice = document.querySelector('#demoNotice');
      demoNotice.textContent = 'Demo mode is active. Paid checkout will be simulated; no card is charged.';
      demoNotice.hidden = false;
    }
    const preset = qs('type');
    if (preset) document.querySelector('#agentType').value = preset;
    renderStep();
  } catch (error) {
    showError(errorBox, error.message);
    nextButton.disabled = true;
  }
}

function plainEvidenceLabel(option) {
  if (option.value === 'none') return "I do not know / no proof yet";
  if (option.value === 'customer_assertion') return 'My answer only (not verified)';
  return option.label;
}

function renderStep() {
  hideError(errorBox);
  const totalSteps = questionnaire.length + 1;
  const currentStep = stepIndex + 1;
  const percent = questionnaire.length ? Math.round((stepIndex / questionnaire.length) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  backButton.hidden = stepIndex === 0;

  if (stepIndex === 0) {
    profileStep.hidden = false;
    questionStage.hidden = true;
    progressLabel.textContent = `Step 1 of ${totalSteps}`;
    nextButton.hidden = false;
    submitButton.hidden = true;
    return;
  }

  profileStep.hidden = true;
  questionStage.hidden = false;
  const question = questionnaire[stepIndex - 1];
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
  const last = stepIndex === questionnaire.length;
  nextButton.hidden = last;
  submitButton.hidden = !last;
  questionStage.focus?.();
}

function validateProfile() {
  const name = document.querySelector('#agentName').value.trim();
  const type = document.querySelector('#agentType').value;
  if (!name) {
    showError(errorBox, 'Give the agent a name so you can recognise this result later.');
    document.querySelector('#agentName').focus();
    return false;
  }
  if (!type) {
    showError(errorBox, 'Choose the closest description of what the agent does.');
    document.querySelector('#agentType').focus();
    return false;
  }
  return true;
}

function saveCurrentQuestion() {
  const question = questionnaire[stepIndex - 1];
  const selected = form.querySelector('input[name="currentQuestion"]:checked');
  if (!selected) {
    showError(errorBox, 'Choose the closest answer, or select “I’m not sure”.');
    return false;
  }
  const evidence = selected.value === 'unknown' ? 'none' : evidenceSelect.value || 'customer_assertion';
  answers.set(question.id, { value: selected.value, evidence });
  return true;
}

nextButton.addEventListener('click', () => {
  hideError(errorBox);
  if (stepIndex === 0 && !validateProfile()) return;
  if (stepIndex > 0 && !saveCurrentQuestion()) return;
  if (stepIndex < questionnaire.length) {
    stepIndex += 1;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

backButton.addEventListener('click', () => {
  hideError(errorBox);
  if (stepIndex > 0) {
    if (stepIndex > 0 && stepIndex <= questionnaire.length) {
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
  if (stepIndex !== questionnaire.length || !saveCurrentQuestion()) return;
  if (!validateProfile()) {
    stepIndex = 0;
    renderStep();
    return;
  }
  const payloadAnswers = Object.fromEntries(questionnaire.map((question) => [question.id, answers.get(question.id)]));
  setBusy(submitButton, true, 'Building your result…');
  try {
    const payload = await api('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({
        name: document.querySelector('#agentName').value.trim(),
        agentType: document.querySelector('#agentType').value,
        answers: payloadAnswers,
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
