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
  assert.match(html, /Know what your agent can do\. Stop what it should not\./);
  assert.match(html, /helps you understand an AI agent’s access, block unsafe actions/i);
  assert.match(html, /Business owners/);
  assert.match(html, /Developers/);
  assert.match(html, /Security teams/);
  assert.match(html, /href="\/assessment\.html">Check an agent free/);
  assert.match(html, /Four steps from uncertainty to a controlled decision/);
  assert.match(html, /not an accredited certification or guarantee/i);
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
  assert.match(html, /one question at a time/i);
  assert.match(html, /“I’m not sure” means information required—not a vulnerability/);
  assert.match(html, /Briefly describe what it does/);
  assert.match(html, /Autonomous \/ general-purpose agent/);
  assert.match(html, /required for “Other”/);
  assert.match(html, /Do you have proof for this answer\?/);
  assert.doesNotMatch(html, /25 security controls/);
  assert.match(js, /flowQuestions\[stepIndex - 1\]/);
  assert.match(js, /type === 'Other' && description\.length < 10/);
  assert.match(js, /payloadAnswers\.__system_description/);
  assert.match(html, /revisionNotice/);
  assert.match(js, /updateFrom/);
  assert.match(js, /flowQuestions/);
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
  assert.match(html, /Security check result/);
  assert.match(js, /Your next action/);
  assert.match(js, /Information needed/);
  assert.match(js, /unresolved assessment inputs, not discovered vulnerabilities/);
  assert.match(js, /No control weakness was established/);
  assert.match(js, /What could happen/);
  assert.match(js, /Who should own it/);
  assert.match(js, /How to prove it is fixed/);
  assert.match(js, /Not determined/);
  assert.match(js, /Security information completeness/);
  assert.match(js, /Create updated assessment/);
  assert.match(js, /Technical score and evidence details/);
  assert.match(js, /escapeHtml\(finding\.title\)/);
  assert.match(js, /escapeHtml\(finding\.observed\)/);
});

test('dashboard calculates one recommended next action and keeps other work secondary', () => {
  const html = read('public/dashboard.html');
  const js = read('public/dashboard.js');
  assert.match(html, /Your next security step/);
  assert.match(js, /Recommended first step/);
  assert.match(js, /Urgent review/);
  assert.match(js, /Work in progress/);
  assert.match(js, /Next protection step/);
  assert.match(js, /dashboard-recommended-action/);
  assert.match(js, /Other security tasks/);
  assert.match(js, /This is a guide, not an automatic deployment approval/);
  assert.match(js, /create an updated assessment with the clarified answers/);
  assert.match(js, /Security information incomplete/);
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
  assert.match(resultJs, /Create updated assessment/);
  assert.match(resultJs, /token && !isOwner/);
  assert.match(assessmentJs, /sourceAssessmentId/);
  assert.match(assessmentJs, /only unresolved questions need a new answer/i);
  assert.doesNotMatch(assessmentJs, /localStorage/);
});

test('control plane defaults to one human next step and preserves specialist controls on demand', () => {
  const html = read('public/control-plane.html');
  const js = read('public/control-plane.js');
  assert.match(html, /Stop unsafe actions before they reach your systems/);
  assert.match(html, /Begin with one safe built-in example/);
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
    pro_report: { name: 'AI agent security assessment', amountPence: 9900, recurring: false },
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
