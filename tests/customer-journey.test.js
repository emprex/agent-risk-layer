import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';
import { plans } from '../src/config.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function safestAnswers() {
  return Object.fromEntries(questionnaire.map((question) => [question.id, {
    value: question.options[0].value,
    evidence: 'customer_assertion',
  }]));
}

test('homepage explains the product, audience, value and first action in plain language', () => {
  const html = read('public/index.html');
  assert.match(html, /Before your AI agent reaches production, know what it can do—and prove the controls worked\./);
  assert.match(html, /Map what it can access and change, verify the controls around it/i);
  assert.match(html, /Assess\. Control\. Prove\./);
  assert.match(html, /Before production/);
  assert.match(html, /When a customer asks for proof/);
  assert.match(html, /href="\/assessment\.html">Assess one agent free/);
  assert.match(html, /From uncertainty to an evidence-backed decision in four steps/);
  assert.match(html, /not accredited certifications or guarantees/i);
});

test('task chooser lets beginners select a situation without learning product architecture', () => {
  const html = read('public/start.html');
  assert.match(html, /Where are you with your AI agent\?/);
  assert.match(html, /I need to understand the risk/);
  assert.match(html, /I need to fix and prove progress/);
  assert.match(html, /I need live protection/);
  assert.match(html, /Start the free check/);
});

test('assessment presents one guided question at a time, captures unusual agents and treats proof honestly', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');
  assert.match(html, /Which agent are you checking\?/i);
  assert.match(html, /“I’m not sure” remains an information gap rather than a vulnerability/);
  assert.match(html, /Briefly describe what it does/);
  assert.match(html, /Autonomous \/ general-purpose agent/);
  assert.match(html, /required for “Other”/);
  assert.match(html, /Evidence for this answer/);
  assert.match(html, /answer remains unverified unless linked to reviewed evidence or a repeatable test later/i);
  assert.match(html, /Selecting an option here never creates verified evidence/i);
  assert.match(js, /evidence_ready/);
  assert.doesNotMatch(html, /25 security controls/);
  assert.match(js, /flowQuestions\[stepIndex - 1\]/);
  assert.match(js, /type === 'Other' && description\.length < 10/);
  assert.match(js, /payloadAnswers\.__system_description/);
  assert.match(html, /revisionNotice/);
  assert.match(html, /revisionQuestionNav/);
  assert.match(html, /Jump to a question/);
  assert.match(js, /updateFrom/);
  assert.match(js, /flowQuestions/);
  assert.match(js, /renderRevisionQuestionNav/);
  assert.match(js, /data-question-index/);
  assert.match(js, /Save updated result/);
  assert.match(js, /previous assessment remains unchanged/i);
  assert.doesNotMatch(js, /localStorage/);
  assert.match(js, /saved\?\.evidence \|\| 'customer_assertion'/);
  assert.match(js, /selected\.value === 'unknown' \? 'none'/);
  assert.doesNotMatch(js, /questionnaire\.map\(.*question-card/s);
});

test('unknown answers fail closed as information gaps without inventing vulnerabilities', () => {
  const answers = safestAnswers();
  for (const question of questionnaire) {
    assert.ok(question.options.some((option) => option.value === 'unknown'), question.id);
    answers[question.id] = { value: 'unknown', evidence: 'none' };
  }
  const result = evaluateAssessment(answers);
  assert.equal(result.riskBand, 'Undetermined');
  assert.equal(result.scoreAvailable, false);
  assert.equal(result.decision, 'HOLD FOR INFORMATION');
  assert.equal(result.evidenceConfidence, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.unresolvedItems.length, questionnaire.length);
  assert.match(result.headline, /No vulnerability is inferred/i);
});

test('result page puts information gaps, real findings and practical next actions before technical scoring', () => {
  const html = read('public/result.html');
  const js = read('public/result.js');
  assert.match(html, /AI-agent security assessment result/);
  assert.match(js, /Next action/);
  assert.match(js, /Information gaps/);
  assert.match(js, /unresolved assessment inputs, not discovered vulnerabilities/);
  assert.match(js, /No control weakness was established/);
  assert.match(js, /What could happen/);
  assert.match(js, /Who should own it/);
  assert.match(js, /How to prove it is fixed/);
  assert.match(js, /Not determined/);
  assert.match(js, /Security information completeness/);
  assert.match(js, /updated assessment/i);
  assert.match(js, /Update answers/);
  assert.match(js, /assessmentRemediationHref/);
  assert.doesNotMatch(js, /href="\/control-plane\\.html#remediation">Track fixes/);
  assert.match(js, /Technical score, controls and evidence/);
  assert.match(js, /Aggregate declared score/);
  assert.match(js, /Highest declared finding/);
  assert.match(js, /Not applicable — declared, not verified/);
  assert.match(js, /escapeHtml\(finding\.title\)/);
  assert.match(js, /escapeHtml\(finding\.observed\)/);
});

test('dashboard calculates one recommended next action and keeps other work secondary', () => {
  const html = read('public/dashboard.html');
  const js = read('public/dashboard.js');
  assert.match(html, /AI agent security/);
  assert.match(html, /take the one action that most improves the evidence for deployment/);
  assert.match(js, /function nextActionForAssessment/);
  assert.match(js, /Next action/);
  assert.match(js, /Complete the missing security information/);
  assert.match(js, /Review the highest-priority declared weaknesses/);
  assert.match(js, /Review deployment evidence for this exact agent/);
  assert.match(js, /This is not a deployment decision/);
  assert.match(js, /Unknown information is not a vulnerability/);
  assert.match(js, /workspace-secondary/);
});

test('assessment continuation preserves history and limits raw-answer prefill to authorised callers', () => {
  const server = read('server.js');
  const resultJs = read('public/result.js');
  const assessmentJs = read('public/assessment.js');
  assert.match(server, /const canRevise = Boolean\(isOwner \|\| \(!row\.user_id && hasToken\)\)/);
  assert.match(server, /revisionSource/);
  assert.match(server, /delete answers\.__source_assessment_id/);
  assert.match(server, /if \(sourceAssessment\) answers\.__source_assessment_id = sourceAssessment\.id/);
  assert.match(server, /You do not have permission to create an update from this assessment/);
  assert.match(resultJs, /updated assessment/i);
  assert.match(resultJs, /token && !isOwner/);
  assert.match(assessmentJs, /sourceAssessmentId/);
  assert.match(assessmentJs, /only unresolved questions need a new answer/i);
  assert.doesNotMatch(assessmentJs, /localStorage/);
});

test('control plane defaults to one human next step and preserves specialist controls on demand', () => {
  const html = read('public/control-plane.html');
  const js = read('public/control-plane.js');
  assert.match(js, /assessmentId = handoffParams\.get\('assessment'\)/);
  assert.match(js, /Nothing will be added to another agent unless you explicitly choose it/);
  assert.match(js, /assessmentProjectConfirmed/);
  assert.match(js, /assessmentId,/);
  assert.match(js, /findingKey: remediationFindingKey/);
  assert.match(html, /Runtime and remediation/);
  assert.match(html, /review protection decisions, fix confirmed weaknesses and retest the exact control before closure/i);
  assert.doesNotMatch(html, /AI security control plane/i);
  assert.match(js, /Do this next/);
  assert.match(js, /Run the safe example/);
  assert.match(js, /No terminal or real system is involved/);
  assert.match(js, /Four automatic checks\. One button\./);
  assert.match(js, /guided-protection-check/);
  assert.match(js, /sessionStorage\.getItem\('arl_control_plane_mode'\) === 'technical'/);
  assert.match(js, /Open specialist view/);
  assert.match(js, /Policies, keys, approvals, access inventory, remediation and audit records are preserved/);
  assert.match(js, /Open technical controls/);
});

test('public entry pages use one plain navigation and one consistent primary action', () => {
  for (const name of ['auth.html', 'demo.html', 'trust.html', 'compare.html', 'security-center.html', 'company.html', 'status.html']) {
    const html = read(`public/${name}`);
    assert.match(html, />Product</, name);
    assert.match(html, />See it work</, name);
    assert.match(html, /href="\/pricing\.html">Pricing</, name);
    assert.match(html, /href="\/trust\.html">Trust</, name);
    assert.match(html, /href="\/help\.html">Help</, name);
    assert.match(html, />Check an agent free</, name);
  }
  const auth = read('public/auth.html');
  assert.match(auth, /Save your checks and keep improving/);
  assert.match(auth, /Check one AI agent/);
  assert.match(auth, /Fix and check again/);
  assert.doesNotMatch(auth, /issue a scoped API key/i);
});

test('customer-facing pages use external scripts and preserve security boundaries', () => {
  for (const name of ['index.html', 'start.html', 'assessment.html', 'auth.html', 'dashboard.html', 'result.html', 'pricing.html', 'demo.html', 'trust.html', 'compare.html', 'security-center.html', 'company.html', 'status.html']) {
    const html = read(`public/${name}`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, name);
    assert.doesNotMatch(html, /\son\w+\s*=/i, name);
  }
  const shared = read('public/shared.js');
  assert.match(shared, /X-CSRF-Token/);
  assert.match(shared, /credentials: 'same-origin'/);
  assert.match(shared, /cache: 'no-store'/);
  const server = read('server.js');
  assert.match(server, /\['\.html', '\.js', '\.mjs', '\.css'\]\.includes\(extension\)/);
});

test('the public sitemap includes the customer task chooser', () => {
  assert.match(read('server.js'), /'\/start\.html'/);
});

test('commercial catalogue contains only the approved current prices', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(plans).map(([key, plan]) => [key, {
    name: plan.name,
    amountPence: plan.amountPence,
    recurring: plan.recurring,
  }])), {
    pro_report: { name: 'AI Agent Security Assessment', amountPence: 9900, recurring: false },
    developer_monthly: { name: 'Developer', amountPence: 2900, recurring: true },
    team_monthly: { name: 'Team', amountPence: 9900, recurring: true },
    agency_monthly: { name: 'Agency', amountPence: 24900, recurring: true },
  });

  const publicCopy = [
    'public/index.html', 'public/pricing.html', 'public/pricing.js',
    'public/help.html', 'public/result.js',
  ].map(read).join('\n');
  assert.doesNotMatch(publicCopy, /£9\.99|£24\.99|£19(?:\.00)?\s*\/\s*month/i);

  const stripeMaintenance = read('scripts/update-stripe-render-prices.mjs');
  assert.match(stripeMaintenance, /name: 'AI Agent Security Assessment'/);
  assert.doesNotMatch(stripeMaintenance, /name: 'Founding Security Assessment'|founding security assessment\./i);
  assert.match(stripeMaintenance, /lookupKey: 'agentrisklayer_founding_assessment_gbp_99_v900'/);
});

test('£99 offer describes actual fulfilment and never implies payment performs technical work', () => {
  const publicCopy = ['public/index.html', 'public/pricing.html', 'public/pricing.js', 'public/result.js'].map(read).join('\n');
  assert.match(publicCopy, /Purchasing does not itself perform a human review, run a test or certify the agent/);
  assert.match(publicCopy, /reported only when completed/);
  assert.doesNotMatch(publicCopy, /signed PDF report|signed report and PDF delivery/i);
});

test('legacy checkout branch and stale public validation counters are removed safely', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /productKey === 'basic_report'/);
  assert.doesNotMatch(server, /already has an Essential report/);

  const securityCentre = read('public/security-center.html');
  assert.doesNotMatch(securityCentre, /\b(?:20|86|89|141|150)\s*\/\s*(?:20|86|89|142|151)\b/);
  assert.match(securityCentre, /No invented certification/);
  assert.match(securityCentre, /independent penetration testing and formal certification are not claimed/i);

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.validate, 'node scripts/validate-release.mjs');
  const validateRunner = read('scripts/validate-release.mjs');
  assert.match(validateRunner, /test:detection-benchmark/);
  const benchmark = read('scripts/run-detection-benchmark.mjs');
  assert.match(benchmark, /Small internal synthetic English regression set/);
  assert.doesNotMatch(benchmark, /public synthetic English cases/);
});

test('release validation isolates credentials and live readiness exposes real PostgreSQL schema state', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.ok(packageJson.scripts.test.includes("! -name 'postgresql-billing-gate.test.js'"));
  assert.doesNotMatch(packageJson.scripts.test, /postgresql-production-readonly/);
  assert.equal(packageJson.scripts['test:postgresql-production-readonly'], undefined);
  assert.equal(packageJson.scripts.validate, 'node scripts/validate-release.mjs');

  const validateRunner = read('scripts/validate-release.mjs');
  assert.match(validateRunner, /sensitiveKeys/);
  assert.match(validateRunner, /delete env\[key\]/);
  assert.doesNotMatch(validateRunner, /postgresql-production-readonly/);
  assert.match(validateRunner, /requireZeroSkips/);

  const server = read('server.js');
  assert.match(server, /expectedLatestMigration/);
  assert.match(server, /schemaCurrent/);
  assert.match(server, /latestMigration/);
  assert.match(server, /migrationCount/);
  assert.ok(server.includes("filter((name) => /^[0-9]{3}_[a-z0-9_-]+[.]sql$/i.test(name))"));
});