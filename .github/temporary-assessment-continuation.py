from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


# Assessment page: make revision mode visible without exposing source answers in HTML.
replace_once(
    'public/assessment.html',
    '</div>\n<form id="assessmentForm" novalidate="">',
    '</div>\n<div class="notice" hidden="" id="revisionNotice" role="status"></div>\n<form id="assessmentForm" novalidate="">',
)

# Assessment client: securely fetch the prior assessment, prefill valid answers,
# and ask only unresolved questions while creating a new immutable assessment.
path = 'public/assessment.js'
text = read(path)
replace_pairs = [
    (
        "const agentType = document.querySelector('#agentType');\nconst agentDescription = document.querySelector('#agentDescription');",
        "const agentName = document.querySelector('#agentName');\nconst agentType = document.querySelector('#agentType');\nconst agentDescription = document.querySelector('#agentDescription');\nconst revisionNotice = document.querySelector('#revisionNotice');\nconst updateFrom = qs('updateFrom');\nconst updateToken = qs('token');",
    ),
    (
        "let questionnaire = [];\nlet evidenceOptions = [];\nlet stepIndex = 0;\nconst answers = new Map();",
        "let questionnaire = [];\nlet flowQuestions = [];\nlet evidenceOptions = [];\nlet stepIndex = 0;\nlet sourceAssessmentId = '';\nconst answers = new Map();",
    ),
]
for old, new in replace_pairs:
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one match for {old[:80]!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)

old_init = """async function init() {
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
    if (preset) agentType.value = preset;
    updateDescriptionRequirement();
    renderStep();
  } catch (error) {
    showError(errorBox, error.message);
    nextButton.disabled = true;
  }
}
"""
new_init = """async function init() {
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
  const evidence = candidate.value === 'unknown'
    ? 'none'
    : candidate.evidence === 'none' ? 'none' : 'customer_assertion';
  return { value: candidate.value, evidence };
}

function applyRevisionSource(source) {
  sourceAssessmentId = source.assessmentId;
  agentName.value = source.name || '';
  agentType.value = source.agentType || '';
  const sourceAnswers = source.answers && typeof source.answers === 'object' ? source.answers : {};
  agentDescription.value = String(sourceAnswers.__system_description || '').slice(0, 800);
  answers.clear();
  for (const question of questionnaire) {
    const answer = normaliseSourceAnswer(question, sourceAnswers[question.id]);
    if (answer) answers.set(question.id, answer);
  }
  flowQuestions = questionnaire.filter((question) => !answers.has(question.id) || answers.get(question.id)?.value === 'unknown');
  if (!flowQuestions.length) flowQuestions = questionnaire;
  revisionNotice.textContent = flowQuestions.length === questionnaire.length && !questionnaire.some((question) => answers.get(question.id)?.value === 'unknown')
    ? `Creating an updated assessment from ${source.name}. Previous answers are prefilled for review. The previous assessment remains unchanged.`
    : `Creating an updated assessment from ${source.name}. Previous known answers are prefilled; only unresolved questions need a new answer. The previous assessment remains unchanged.`;
  revisionNotice.hidden = false;
}
"""
if text.count(old_init) != 1:
    raise SystemExit('public/assessment.js: init block did not match exactly')
text = text.replace(old_init, new_init, 1)
for old, new in [
    ('const totalSteps = questionnaire.length + 1;', 'const totalSteps = flowQuestions.length + 1;'),
    ('const percent = questionnaire.length ? Math.round((stepIndex / questionnaire.length) * 100) : 0;', 'const percent = flowQuestions.length ? Math.round((stepIndex / flowQuestions.length) * 100) : 0;'),
    ('const last = stepIndex === questionnaire.length;', 'const last = stepIndex === flowQuestions.length;'),
    ('if (stepIndex < questionnaire.length) {', 'if (stepIndex < flowQuestions.length) {'),
    ('if (stepIndex <= questionnaire.length) {', 'if (stepIndex <= flowQuestions.length) {'),
    ("if (stepIndex !== questionnaire.length || !saveCurrentQuestion()) return;", "if (stepIndex !== flowQuestions.length || !saveCurrentQuestion()) return;"),
]:
    if text.count(old) != 1:
        raise SystemExit(f'public/assessment.js: expected one match for {old!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)
if text.count('const question = questionnaire[stepIndex - 1];') != 2:
    raise SystemExit('public/assessment.js: expected two current-question references')
text = text.replace('const question = questionnaire[stepIndex - 1];', 'const question = flowQuestions[stepIndex - 1];', 2)
old_submit = """body: JSON.stringify({
        name: document.querySelector('#agentName').value.trim(),
        agentType: agentType.value,
        answers: payloadAnswers,
      }),"""
new_submit = """body: JSON.stringify({
        name: agentName.value.trim(),
        agentType: agentType.value,
        answers: payloadAnswers,
        sourceAssessmentId: sourceAssessmentId || undefined,
        sourceAccessToken: sourceAssessmentId ? updateToken || undefined : undefined,
      }),"""
if text.count(old_submit) != 1:
    raise SystemExit('public/assessment.js: submit block mismatch')
text = text.replace(old_submit, new_submit, 1)
write(path, text)

# Result page: clear naming + immutable prefilled continuation.
path = 'public/result.js'
text = read(path)
for old, new in [
    ('let isOwner = false;', "let isOwner = false;\nlet revisionSource = null;"),
    ('isOwner = assessmentPayload.isOwner;\n    user = userPayload.user;', 'isOwner = assessmentPayload.isOwner;\n    revisionSource = assessmentPayload.revisionSource || null;\n    user = userPayload.user;'),
    ('<span>Assessment completeness</span>', '<span>Security information completeness</span>'),
    ('<span class="risk-pill">Assessment incomplete</span>', '<span class="risk-pill">Security information incomplete</span>'),
]:
    if text.count(old) != 1:
        raise SystemExit(f'public/result.js: expected one match for {old!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)
marker = 'function render() {'
if text.count(marker) != 1:
    raise SystemExit('public/result.js: render marker mismatch')
text = text.replace(marker, """function revisionHref() {
  if (!revisionSource) return '/assessment.html';
  const params = new URLSearchParams({ updateFrom: revisionSource.assessmentId });
  if (token) params.set('token', token);
  return `/assessment.html?${params.toString()}`;
}

function render() {""", 1)
old_cta = """${!unresolvedState.exact ? '<p class="microcopy">The free result shows the unresolved control questions available in this summary plus the remaining context count. A new check can record the clarified answers without rewriting this historical result.</p>' : ''}
        <a class="button ghost" href="/assessment.html">Run a new check with the clarified information</a>"""
new_cta = """${!unresolvedState.exact ? '<p class="microcopy">The free result shows the unresolved control questions available in this summary plus the remaining context count.</p>' : ''}
        ${revisionSource ? `<p class="microcopy">Create an updated assessment after you confirm the missing information. Your profile and known answers are prefilled, only unresolved questions need a new answer, and this historical result remains unchanged.</p><a class="button ghost" href="${revisionHref()}">Create updated assessment</a>` : '<a class="button ghost" href="/assessment.html">Run a new check with the clarified information</a>'}"""
if text.count(old_cta) != 1:
    raise SystemExit('public/result.js: unresolved CTA block mismatch')
text = text.replace(old_cta, new_cta, 1)
write(path, text)

# Public result and dashboard wording.
replace_once('public/public-result.js', "'Assessment incomplete'", "'Security information incomplete'")
path = 'public/dashboard.js'
text = read(path)
for old, new in [
    ('then run a new check with the clarified answers.', 'then create an updated assessment with the clarified answers.'),
    ('<span class="risk-pill">Assessment incomplete</span>', '<span class="risk-pill">Security information incomplete</span>'),
    ('Clarify the incomplete assessment before creating fixes', 'Clarify the missing security information before creating fixes'),
]:
    if text.count(old) != 1:
        raise SystemExit(f'public/dashboard.js: expected one match for {old!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)
write(path, text)

# Server: source answers are available only to the signed-in owner or token-holder of an
# unclaimed assessment; an update creates a new row and keeps the source immutable.
path = 'server.js'
text = read(path)
old_eval = """                const result = evaluateAssessment(body.answers || {}, { agentType });
                const assessmentId = id('asm_');
"""
new_eval = """                const sourceAssessmentId = cleanText(body.sourceAssessmentId || '', 80);
                let sourceAssessment = null;
                if (sourceAssessmentId) {
                    sourceAssessment = await db.prepare('SELECT id,user_id,access_token FROM assessments WHERE id = ?').get(sourceAssessmentId);
                    if (!sourceAssessment)
                        throw Object.assign(new Error('Source assessment not found.'), { statusCode: 404 });
                    const sourceOwned = Boolean(req.user && sourceAssessment.user_id === req.user.id);
                    const unclaimedWithToken = Boolean(!sourceAssessment.user_id && body.sourceAccessToken && constantTimeTextEqual(String(body.sourceAccessToken), sourceAssessment.access_token));
                    if (!sourceOwned && !unclaimedWithToken)
                        throw Object.assign(new Error('You do not have permission to create an update from this assessment.'), { statusCode: 403 });
                }
                const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? { ...body.answers } : {};
                if (sourceAssessment) answers.__source_assessment_id = sourceAssessment.id;
                const result = evaluateAssessment(answers, { agentType, sourceAssessmentId: sourceAssessment?.id || null });
                const assessmentId = id('asm_');
"""
if text.count(old_eval) != 1:
    raise SystemExit('server.js: assessment evaluation block mismatch')
text = text.replace(old_eval, new_eval, 1)
for old, new in [
    ('JSON.stringify(body.answers), result.score, result.riskBand', 'JSON.stringify(answers), result.score, result.riskBand'),
    ("{ assessmentId, score: result.score, riskBand: result.riskBand, agentType }", "{ assessmentId, sourceAssessmentId: sourceAssessment?.id || null, score: result.score, riskBand: result.riskBand, agentType }"),
]:
    if text.count(old) != 1:
        raise SystemExit(f'server.js: expected one match for {old!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)
old_catch = """                return json(res, 400, { error: error.message });
            }
        }
        let match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);"""
new_catch = """                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        let match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);"""
if text.count(old_catch) != 1:
    raise SystemExit('server.js: assessment catch block mismatch')
text = text.replace(old_catch, new_catch, 1)
old_get = """            const redTeamRun = isOwner ? await latestRedTeamRun(row.id) : null;
            return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier, inspection, redTeamRun), canDownload: effectiveTier !== 'free', isOwner, subscriptionAccess: subscribed, superuserAccess, inspection, redTeamRun });
"""
new_get = """            const redTeamRun = isOwner ? await latestRedTeamRun(row.id) : null;
            const canRevise = Boolean(isOwner || (!row.user_id && hasToken));
            const revisionSource = canRevise ? {
                assessmentId: row.id,
                name: row.name,
                agentType: row.agent_type,
                answers: parseJson(row.answers_json, {}),
                scoringVersion: row.scoring_version,
                createdAt: row.created_at,
            } : null;
            return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier, inspection, redTeamRun), canDownload: effectiveTier !== 'free', isOwner, subscriptionAccess: subscribed, superuserAccess, revisionSource, inspection, redTeamRun });
"""
if text.count(old_get) != 1:
    raise SystemExit('server.js: GET assessment response block mismatch')
text = text.replace(old_get, new_get, 1)
write(path, text)

# Report/PDF terminology; internal compatibility field stays assessmentCompleteness.
replace_once('src/report.js', 'Assessment completeness is ${base.metrics.assessmentCompleteness}%', 'Security information completeness is ${base.metrics.assessmentCompleteness}%')
path = 'src/pdf.js'
text = read(path)
for old, new in [
    ("label: 'Assessment completeness'", "label: 'Security information completeness'"),
    ("note: scoreAvailable ? report.riskBand : 'Assessment incomplete'", "note: scoreAvailable ? report.riskBand : 'Security information incomplete'"),
    ("riskBar('Assessment completeness', report.metrics.assessmentCompleteness ?? 100, 'accent');", "riskBar('Security information completeness', report.metrics.assessmentCompleteness ?? 100, 'accent');"),
]:
    if text.count(old) != 1:
        raise SystemExit(f'src/pdf.js: expected one match for {old!r}, found {text.count(old)}')
    text = text.replace(old, new, 1)
write(path, text)

# Customer-journey contract and regression guards.
path = 'CUSTOMER_JOURNEY_V10.md'
text = read(path).replace('assessment completeness', 'security information completeness')
marker = '- The customer can move from `Unknown → clarified answer → evidence → test → finding/remediation if needed → retest` without losing assessment scope.\n'
addition = marker + '- An incomplete result can create a new, prefilled updated assessment that asks only unresolved questions; the historical source assessment remains unchanged.\n'
if text.count(marker) != 1:
    raise SystemExit('CUSTOMER_JOURNEY_V10.md: continuation marker mismatch')
text = text.replace(marker, addition, 1)
write(path, text)

path = 'tests/customer-journey.test.js'
text = read(path)
old = "  assert.match(js, /payloadAnswers\\.__system_description/);"
new = "  assert.match(js, /payloadAnswers\\.__system_description/);\n  assert.match(html, /revisionNotice/);\n  assert.match(js, /updateFrom/);\n  assert.match(js, /flowQuestions/);\n  assert.match(js, /previous assessment remains unchanged/i);\n  assert.doesNotMatch(js, /localStorage/);"
if text.count(old) != 1:
    raise SystemExit('tests/customer-journey.test.js: assessment marker mismatch')
text = text.replace(old, new, 1)
old = '  assert.match(js, /Assessment completeness/);'
new = '  assert.match(js, /Security information completeness/);\n  assert.match(js, /Create updated assessment/);'
if text.count(old) != 1:
    raise SystemExit('tests/customer-journey.test.js: result label marker mismatch')
text = text.replace(old, new, 1)
old = """  assert.match(js, /This is a guide, not an automatic deployment approval/);
});
"""
new = """  assert.match(js, /This is a guide, not an automatic deployment approval/);
  assert.match(js, /create an updated assessment with the clarified answers/);
  assert.match(js, /Security information incomplete/);
});

test('assessment continuation preserves history and limits raw-answer prefill to authorised callers', () => {
  const server = read('server.js');
  const resultJs = read('public/result.js');
  const assessmentJs = read('public/assessment.js');
  assert.match(server, /const canRevise = Boolean\(isOwner \|\| \(!row\.user_id && hasToken\)\)/);
  assert.match(server, /revisionSource/);
  assert.match(server, /__source_assessment_id/);
  assert.match(server, /You do not have permission to create an update from this assessment/);
  assert.match(resultJs, /Create updated assessment/);
  assert.match(assessmentJs, /sourceAssessmentId/);
  assert.match(assessmentJs, /only unresolved questions need a new answer/i);
  assert.doesNotMatch(assessmentJs, /localStorage/);
});
"""
if text.count(old) != 1:
    raise SystemExit('tests/customer-journey.test.js: dashboard marker mismatch')
text = text.replace(old, new, 1)
write(path, text)

for target in ['public/result.js', 'public/public-result.js', 'public/dashboard.js', 'src/pdf.js', 'src/report.js', 'CUSTOMER_JOURNEY_V10.md']:
    if 'Assessment completeness' in read(target):
        raise SystemExit(f'{target}: stale Assessment completeness label remains')

print('Focused assessment continuation patch applied successfully.')
