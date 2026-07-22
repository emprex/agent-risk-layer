import { api, escapeHtml, hideError, qs, setBusy, showError } from './shared.js';

const form = document.querySelector('#assessmentForm');
const list = document.querySelector('#questionList');
const errorBox = document.querySelector('#formError');
const progressBar = document.querySelector('#progressBar');
const progressText = document.querySelector('#progressText');
const submit = document.querySelector('#submitAssessment');
let questionnaire = [];

async function init() {
  try {
    const [{ questionnaire: questions }, cfg] = await Promise.all([api('/api/questionnaire'), api('/api/config')]);
    questionnaire = questions;
    if (cfg.demoMode) document.querySelector('#demoNotice').hidden = false;
    const preset = qs('type');
    if (preset) document.querySelector('#agentType').value = preset;
    list.innerHTML = questions.map((q, index) => `
      <section class="question-card">
        <h3>${index + 1}. ${escapeHtml(q.title)}</h3>
        <p>${escapeHtml(q.help)}</p>
        <div class="option-grid">
          ${q.options.map((o) => `<label class="option"><input type="radio" name="${escapeHtml(q.id)}" value="${escapeHtml(o.value)}" required><span>${escapeHtml(o.label)}</span></label>`).join('')}
        </div>
      </section>`).join('');
    list.addEventListener('change', updateProgress);
    updateProgress();
  } catch (error) {
    list.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

function updateProgress() {
  const answered = questionnaire.filter((q) => form.querySelector(`input[name="${q.id}"]:checked`)).length;
  const profile = Number(Boolean(document.querySelector('#agentName').value.trim())) + Number(Boolean(document.querySelector('#agentType').value));
  const percent = Math.round(((answered + profile) / (questionnaire.length + 2)) * 100);
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
}

form.addEventListener('input', updateProgress);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError(errorBox);
  const answers = {};
  for (const question of questionnaire) {
    const selected = form.querySelector(`input[name="${question.id}"]:checked`);
    if (!selected) return showError(errorBox, `Please answer: ${question.title}`);
    answers[question.id] = selected.value;
  }
  setBusy(submit, true, 'Calculating…');
  try {
    const payload = await api('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({ name: document.querySelector('#agentName').value, agentType: document.querySelector('#agentType').value, answers }),
    });
    sessionStorage.setItem('arl_last_assessment', JSON.stringify({ id: payload.assessment.id, token: payload.accessToken }));
    location.href = `/result.html?id=${encodeURIComponent(payload.assessment.id)}&token=${encodeURIComponent(payload.accessToken)}`;
  } catch (error) {
    showError(errorBox, error.message);
    setBusy(submit, false);
  }
});

init();
