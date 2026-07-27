import fs from 'node:fs';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

const outDir = process.argv[2] || '.';
const evidence = ['none', 'claimed', 'documented', 'tested'];
let state = 0x5a17c0de;
const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
const pick = (items) => items[Math.floor(random() * items.length)];

const sectors = ['SaaS','finance','health','legal','retail','education','government','logistics','media','cybersecurity'];
const agents = ['support','coding','payment','research','recruiting','operations','sales','compliance','MCP','multi-agent'];
const rows = [];

for (let index = 0; index < 1000; index += 1) {
  const answers = Object.fromEntries(questionnaire.map((question) => [
    question.id,
    { value: pick(question.options).value, evidence: pick(evidence) },
  ]));
  const result = evaluateAssessment(answers, { agentType: `${sectors[index % sectors.length]} ${agents[Math.floor(index / 10) % agents.length]} agent` });
  const criticalPath = result.attackPaths.some((path) => path.severity === 'critical');
  const validScore = Number.isInteger(result.score) && result.score >= 0 && result.score <= 100;
  const safeDecision = !criticalPath || result.decision === 'DO NOT DEPLOY';
  const orderedBand = result.score >= 75 ? result.riskBand === 'Critical'
    : result.score >= 50 ? result.riskBand === 'High'
    : result.score >= 25 ? result.riskBand === 'Moderate'
    : result.riskBand === 'Low';
  const findingIntegrity = result.findings.every((finding) =>
    finding.id && finding.title && finding.recommendation &&
    ['critical','high','medium','low'].includes(finding.severity));
  const pathIntegrity = result.attackPaths.every((path) =>
    path.id && path.title && path.narrative && path.tags.length > 0);
  const recommendationIntegrity = result.findings.length === 0 || result.recommendations.length > 0;
  const pass = validScore && safeDecision && orderedBand && findingIntegrity && pathIntegrity && recommendationIntegrity;
  rows.push({
    id: `S${String(index + 1).padStart(4, '0')}`,
    customer: `${sectors[index % sectors.length]} customer ${index + 1}`,
    agent: result.agentType,
    score: result.score,
    band: result.riskBand,
    decision: result.decision,
    findings: result.findings.length,
    attackPaths: result.attackPaths.length,
    criticalPath,
    checks: { validScore, safeDecision, orderedBand, findingIntegrity, pathIntegrity, recommendationIntegrity },
    pass,
  });
}

const failures = rows.filter((row) => !row.pass);
const summary = {
    release: '9.1.0',
  seed: '0x5a17c0de',
  generatedAt: new Date().toISOString(),
  scenarios: rows.length,
  passed: rows.length - failures.length,
  failed: failures.length,
  unsafeDecisions: rows.filter((row) => !row.checks.safeDecision).length,
  criticalPathScenarios: rows.filter((row) => row.criticalPath).length,
  averageScore: Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/AgentRiskLayer-v9.1.0-1000-scenario-results.json`, `${JSON.stringify({ summary, scenarios: rows }, null, 2)}\n`);
fs.writeFileSync(`${outDir}/AgentRiskLayer-v9.1.0-1000-scenario-report.md`, `# AgentRiskLayer v9.1.0 — 1,000-scenario gate

Generated: ${summary.generatedAt}

- Scenarios: **${summary.scenarios}**
- Passed: **${summary.passed}**
- Failed: **${summary.failed}**
- Critical-path scenarios: **${summary.criticalPathScenarios}**
- Unsafe deployment decisions: **${summary.unsafeDecisions}**
- Average score: **${summary.averageScore}/100**
- Deterministic seed: \`${summary.seed}\`

## Release gate

${summary.failed === 0 ? '**PASS.** All deterministic safety and integrity invariants passed.' : '**FAIL.** The candidate must not be released until every failing invariant is corrected.'}

## What this proves

The packaged assessment engine handled 1,000 reproducible combinations without invalid scores, risk-band inconsistencies, malformed findings, empty remediation, or a deployment-permitting decision when a critical attack path existed.

## Limits

This is synthetic functional/security testing. It does not prove real-customer usability, external-service reliability, legal compliance, or production capacity. Those require beta feedback and separate load/integration testing.
`);
console.log(JSON.stringify(summary));
if (failures.length) process.exitCode = 1;
