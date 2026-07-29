import { api, escapeHtml, hideError, qs, setBusy, showError } from './shared.js';

const form = document.querySelector('#assessmentForm');
const list = document.querySelector('#questionList');
const errorBox = document.querySelector('#formError');
const progressBar = document.querySelector('#progressBar');
const progressText = document.querySelector('#progressText');
const submit = document.querySelector('#submitAssessment');
let questionnaire = [];
let evidenceOptions = [];

async function init() {
  try {
    const [questionPayload, cfg] = await Promise.all([api('/api/questionnaire'), api('/api/config')]);
    questionnaire = questionPayload.questionnaire;
    evidenceOptions = questionPayload.evidenceOptions || [];
    if (cfg.demoMode) document.querySelector('#demoNotice').hidden = false;
    const preset = qs('type');
    if (preset) document.querySelector('#agentType').value = preset;
    list.innerHTML = questionsHtml();
    list.addEventListener('change', updateProgress);
    updateProgress();
  } catch (error) {
    list.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}

function questionsHtml() {
  let lastDomain = '';
  return questionnaire.map((q, index) => {
    const domain = q.domain !== lastDomain ? `<div class="domain-divider"><span>${escapeHtml(q.domain)}</span></div>` : '';
    lastDomain = q.domain;
    return `${domain}<section class="question-card" data-kind="${escapeHtml(q.kind)}">
      <div class="question-meta"><span>${q.kind === 'exposure' ? 'Exposure' : 'Control'}</span><span>${index + 1} of ${questionnaire.length}</span></div>
      <h3>${escapeHtml(q.title)}</h3>
      <p>${escapeHtml(q.help)}</p>
      <div class="option-grid">
        ${q.options.map((o) => `<label class="option"><input type="radio" name="${escapeHtml(q.id)}" value="${escapeHtml(o.value)}" required><span>${escapeHtml(o.label)}</span></label>`).join('')}
      </div>
      <div class="evidence-row">
        <label for="evidence_${escapeHtml(q.id)}"><strong>Evidence state</strong><span>Questionnaire answers are declarations. Tested or reviewed status requires linked technical evidence.</span></label>
        <select id="evidence_${escapeHtml(q.id)}" name="evidence_${escapeHtml(q.id)}" required>
          <option value="">Select evidence level</option>
          ${evidenceOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>
    </section>`;
  }).join('');
}

function updateProgress() {
  const answered = questionnaire.filter((q) => form.querySelector(`input[name="${q.id}"]:checked`) && document.querySelector(`#evidence_${q.id}`)?.value).length;
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
    const evidence = document.querySelector(`#evidence_${question.id}`)?.value;
    if (!selected) return showError(errorBox, `Please answer: ${question.title}`);
    if (!evidence) return showError(errorBox, `Select an evidence level for: ${question.title}`);
    answers[question.id] = { value: selected.value, evidence };
  }
  setBusy(submit, true, 'Analysing attack paths…');
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
