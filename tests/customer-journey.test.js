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

test('homepage starts with a plain-language customer decision and one primary task', () => {
  const html = read('public/index.html');
  assert.match(html, /Is your AI agent safe to use\?/);
  assert.match(html, /what it can access, what could go wrong and what to fix first/i);
  assert.match(html, /href="\/start\.html">Check my agent/);
  assert.match(html, /Check\. Understand\. Fix\./);
  assert.match(html, /not an accredited certification or guarantee/i);
});

test('task chooser orients customers before exposing technical tools', () => {
  const html = read('public/start.html');
  assert.match(html, /What do you need to do today\?/);
  assert.match(html, /Check an AI agent/);
  assert.match(html, /Fix identified risks/);
  assert.match(html, /Protect a live agent/);
  assert.match(html, /private by default/i);
});

test('assessment presents one guided question at a time and treats proof honestly', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');
  assert.match(html, /one question at a time/i);
  assert.match(html, /You can choose “I’m not sure”/);
  assert.match(html, /Do you have proof for this answer\?/);
  assert.doesNotMatch(html, /25 security controls/);
  assert.match(js, /questionnaire\[stepIndex - 1\]/);
  assert.match(js, /saved\?\.evidence \|\| 'customer_assertion'/);
  assert.match(js, /selected\.value === 'unknown' \? 'none'/);
  assert.doesNotMatch(js, /questionnaire\.map\(.*question-card/s);
});

test('unknown answers fail closed instead of inventing a protection', () => {
  const answers = safestAnswers();
  for (const question of questionnaire) {
    assert.ok(question.options.some((option) => option.value === 'unknown'), question.id);
    answers[question.id] = { value: 'unknown', evidence: 'none' };
  }
  const result = evaluateAssessment(answers);
  assert.equal(result.riskBand, 'Critical');
  assert.equal(result.decision, 'DO NOT DEPLOY');
  assert.equal(result.evidenceConfidence, 0);
  assert.ok(result.findings.every((finding) => finding.observed === "I'm not sure"));
  assert.ok(result.recommendations.some((item) => /Confirm the current control or exposure/.test(item.text)));
});

test('result page puts the decision and practical fixes before technical scoring', () => {
  const html = read('public/result.html');
  const js = read('public/result.js');
  assert.match(html, /Security check result/);
  assert.match(js, /Your next action/);
  assert.match(js, /What could happen/);
  assert.match(js, /Who should own it/);
  assert.match(js, /How to prove it is fixed/);
  assert.match(js, /Technical score and evidence details/);
  assert.match(js, /escapeHtml\(finding\.title\)/);
  assert.match(js, /escapeHtml\(finding\.observed\)/);
});

test('dashboard leads with customer tasks and keeps specialist tools secondary', () => {
  const html = read('public/dashboard.html');
  const js = read('public/dashboard.js');
  assert.match(html, /What do you want to do today\?/);
  assert.match(js, /Check an agent/);
  assert.match(js, /Review my most important risk/);
  assert.match(js, /Fix open risks/);
  assert.match(js, /Protect a running agent/);
  assert.match(js, /<details class="panel section-gap advanced-tools">/);
  assert.match(js, /Technical tools/);
});




test('control plane defaults to one human next step and hides specialist controls until requested', () => {
  const html = read('public/control-plane.html');
  const js = read('public/control-plane.js');
  assert.match(html, /What should your agent be allowed to do\?/);
  assert.match(html, /Start with a safe example/i);
  assert.doesNotMatch(html, /AI security control plane/i);
  assert.match(js, /Run safe protection check/);
  assert.match(js, /No terminal, API key or real refund system is needed/);
  assert.match(js, /uses four of your monthly protection checks/i);
  assert.match(js, /guided-protection-check/);
  assert.match(js, /technicalMode = sessionStorage\.getItem\('arl_control_plane_mode'\) === 'technical'/);
  assert.match(js, /technicalMode \? technicalProjectView\(\) : ''/);
  assert.match(js, /You are already using/);
  assert.match(js, /Show technical controls/);
  assert.match(js, /Four automatic checks\. One button\./);
});

test('customer entry pages keep one plain navigation and explain account value without API jargon', () => {
  for (const name of ['auth.html', 'demo.html', 'trust.html', 'compare.html', 'security-center.html', 'company.html', 'status.html']) {
    const html = read(`public/${name}`);
    assert.match(html, /href="\/start\.html">Start</, name);
    assert.match(html, /href="\/pricing\.html">Pricing</, name);
    assert.match(html, /href="\/trust\.html">Trust</, name);
    assert.match(html, /href="\/help\.html">Help</, name);
    assert.match(html, />Check my agent</, name);
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
  assert.match(securityCentre, /Synthetic regression data is not presented as customer or independent performance evidence/);

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
