import { hideError, showError } from './shared.js';

const profileStep = document.querySelector('#profileStep');
const questionStage = document.querySelector('#questionStage');
const questionTitle = document.querySelector('#questionTitle');
const questionHelp = document.querySelector('#questionHelp');
const questionOptions = document.querySelector('#questionOptions');
const evidenceSelect = document.querySelector('#questionEvidence');
const errorBox = document.querySelector('#formError');
const nextButton = document.querySelector('#nextButton');
const targetRepository = document.querySelector('#targetRepository');
const targetRevision = document.querySelector('#targetRevision');

const QUESTION_COPY = new Map([
  ['Can it move money, delete data, publish content or create binding commitments?', {
    title: 'Can it perform high-impact actions?',
    help: 'Examples include moving money, deleting data, publishing content or creating binding commitments. Choose the highest-impact action it can actually execute; it does not need to support every example.',
  }],
  ['Who can directly interact with the agent?', {
    help: 'Answer for the deployment being assessed today. Documents, retrieval and other indirect inputs are assessed separately.',
  }],
  ['What can connected tools or MCP servers do?', {
    help: 'Choose the most powerful capability actually available. Shell or code execution belongs in the highest option even without administrator access.',
  }],
  ['Can this agent delegate to or receive instructions from other agents?', {
    title: 'Can this agent delegate work to, or accept instructions from, other agents?',
    help: 'Choose the most dynamic relationship actually enabled. Dynamic delegation counts even when peer discovery is not enabled.',
  }],
  ['What is the maximum credible business impact if the agent behaves incorrectly?', {
    help: 'Use real deployment context: customer harm, financial loss, operational interruption or legal exposure. If source code alone cannot establish the business consequence, choose “I’m not sure”.',
  }],
  ['How are agent permissions constrained?', {
    help: 'Answer for the runtime identity or role actually used in this deployment. Source-code capability alone does not establish the permissions granted in production.',
  }],
  ['How are credentials issued and protected?', {
    help: 'Answer for the credentials actually used by this deployment. Product support for environment variables, config files or vaults does not prove which method is in use.',
  }],
]);

function frozenTargetReady() {
  const repository = String(targetRepository?.value || '').trim();
  const revision = String(targetRevision?.value || '').trim().toLowerCase();
  const repositoryOk = /^(?:https:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(repository);
  return repositoryOk && /^[a-f0-9]{40}$/.test(revision);
}

function answeringContextCopy(value) {
  if (value === 'source') {
    return 'Source-code check: answer only what the frozen revision proves. For deployment facts such as real users, credentials, business impact or ownership, choose “I’m not sure” unless you have separate evidence.';
  }
  if (value === 'test') {
    return 'Test/staging check: answer only for this environment today. Product capabilities that are not enabled here do not count as deployed access or authority.';
  }
  if (value === 'production') {
    return 'Production check: answer only for the live deployment and the permissions, users, data and controls that are actually in force now.';
  }
  return 'Choose what you are using to answer this assessment. This changes guidance only; it does not create evidence or change scoring.';
}

function installAnsweringContext() {
  if (!profileStep || profileStep.querySelector('#assessmentAnsweringContext')) return;
  const targetSection = profileStep.querySelector('.workspace-section');
  const wrapper = document.createElement('div');
  wrapper.className = 'assessment-answering-context';
  wrapper.innerHTML = `
    <div>
      <span class="eyebrow">Answering context</span>
      <label for="assessmentAnsweringContext">What are you using to answer this assessment?</label>
      <p id="assessmentAnsweringContextHelp">Choose one before continuing. This guides the questions only and never counts as proof.</p>
    </div>
    <select id="assessmentAnsweringContext" aria-describedby="assessmentAnsweringContextHelp">
      <option value="">Choose one</option>
      <option value="source">Frozen source code / repository</option>
      <option value="test">Test or staging deployment</option>
      <option value="production">Production deployment</option>
    </select>`;
  profileStep.insertBefore(wrapper, targetSection || profileStep.firstChild);

  const select = wrapper.querySelector('select');
  if (frozenTargetReady()) select.value = 'source';
  select.addEventListener('change', () => {
    hideError(errorBox);
    updateBasisNote();
    updateTargetCopy();
  });
}

function answeringContextValue() {
  return document.querySelector('#assessmentAnsweringContext')?.value || '';
}

function updateTargetCopy() {
  const targetSection = profileStep?.querySelector('.workspace-section');
  const help = targetSection?.querySelector('.question-help');
  if (!help) return;
  const text = answeringContextValue() === 'source'
    ? 'Required for a source-code assessment. Add the GitHub repository and full commit SHA so evidence, findings and retests stay tied to one exact version.'
    : 'Add the repository and exact version whenever source evidence, findings or retests should be tied to this assessment.';
  if (help.textContent !== text) help.textContent = text;
}

function installBasisNote() {
  if (!questionStage || questionStage.querySelector('#questionBasisNote')) return;
  const note = document.createElement('div');
  note.id = 'questionBasisNote';
  note.className = 'question-basis-note';
  const guidance = questionStage.querySelector('#questionGuidance');
  questionStage.insertBefore(note, guidance || questionStage.firstChild);
}

function updateBasisNote() {
  const note = document.querySelector('#questionBasisNote');
  if (!note) return;
  const text = answeringContextCopy(answeringContextValue());
  if (note.textContent !== text) note.textContent = text;
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function relabelEvidence() {
  const details = questionStage?.querySelector('.evidence-details');
  if (!details || !evidenceSelect) return;
  setText(details.querySelector('summary'), 'How do you know this?');
  setText(details.querySelector('p'), 'This answer is still unverified. Evidence can be reviewed or tested later.');
  setText(details.querySelector('label[for="questionEvidence"]'), 'Proof available now');
  const labels = {
    none: "I don't have proof yet",
    customer_assertion: 'My answer only — not verified',
    evidence_ready: 'I have supporting evidence to verify later',
  };
  for (const option of evidenceSelect.options) {
    if (labels[option.value] && option.textContent !== labels[option.value]) option.textContent = labels[option.value];
  }
  details.open = true;

  const selected = questionStage.querySelector('input[name="currentQuestion"]:checked');
  const unknown = selected?.value === 'unknown';
  if (unknown && evidenceSelect.value !== 'none') evidenceSelect.value = 'none';
  evidenceSelect.disabled = Boolean(unknown);
}

function refineCurrentQuestion() {
  if (!questionStage || questionStage.hidden || !questionTitle || !questionHelp) return;
  const originalTitle = questionTitle.dataset.arlOriginalTitle || questionTitle.textContent.trim();
  if (!questionTitle.dataset.arlOriginalTitle) questionTitle.dataset.arlOriginalTitle = originalTitle;
  const copy = QUESTION_COPY.get(originalTitle);
  if (copy?.title) setText(questionTitle, copy.title);
  if (copy?.help) setText(questionHelp, copy.help);

  if (originalTitle === 'What can connected tools or MCP servers do?') {
    setText(questionOptions?.querySelector('input[value="privileged"]')?.closest('label')?.querySelector('span'), 'Shell/code execution, admin access or dynamic tool discovery');
  }
  if (originalTitle === 'Can this agent delegate to or receive instructions from other agents?') {
    setText(questionOptions?.querySelector('input[value="dynamic"]')?.closest('label')?.querySelector('span'), 'Dynamic delegation or discovery of agents that are not pre-approved');
  }

  updateBasisNote();
  relabelEvidence();
}

function resetQuestionIdentityWhenNeeded() {
  if (!questionTitle) return;
  const rendered = questionTitle.textContent.trim();
  const stored = questionTitle.dataset.arlOriginalTitle || '';
  const replacementTitles = new Set([...QUESTION_COPY.values()].map((item) => item.title).filter(Boolean));
  if (stored && rendered !== stored && !replacementTitles.has(rendered)) {
    questionTitle.dataset.arlOriginalTitle = rendered;
  }
}

function enhance() {
  installAnsweringContext();
  installBasisNote();
  updateTargetCopy();
  resetQuestionIdentityWhenNeeded();
  refineCurrentQuestion();
}

nextButton?.addEventListener('click', (event) => {
  if (!profileStep || profileStep.hidden) return;
  const basis = answeringContextValue();
  if (!basis) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showError(errorBox, 'Choose whether you are answering from frozen source code, a test deployment or a production deployment.');
    document.querySelector('#assessmentAnsweringContext')?.focus();
    return;
  }
  if (basis === 'source' && !frozenTargetReady()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showError(errorBox, 'For a source-code assessment, add the GitHub repository and the full 40-character commit SHA before continuing.');
    (!String(targetRepository?.value || '').trim() ? targetRepository : targetRevision)?.focus();
  }
}, true);

targetRepository?.addEventListener('input', () => {
  const select = document.querySelector('#assessmentAnsweringContext');
  if (select && !select.value && frozenTargetReady()) select.value = 'source';
  updateTargetCopy();
});
targetRevision?.addEventListener('input', () => {
  const select = document.querySelector('#assessmentAnsweringContext');
  if (select && !select.value && frozenTargetReady()) select.value = 'source';
  updateTargetCopy();
});

questionStage?.addEventListener('change', (event) => {
  if (event.target?.name === 'currentQuestion') relabelEvidence();
});

let observer;
let enhanceQueued = false;
function observe() {
  if (!observer) return;
  if (profileStep) observer.observe(profileStep, { childList: true, subtree: true });
  if (questionStage) observer.observe(questionStage, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
}
function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(() => {
    enhanceQueued = false;
    observer?.disconnect();
    try {
      enhance();
    } finally {
      observe();
    }
  });
}

observer = new MutationObserver(scheduleEnhance);
observe();
enhance();
