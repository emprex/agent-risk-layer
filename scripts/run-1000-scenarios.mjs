import fs from 'node:fs';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

const outDir = process.argv[2] || '.';
const release = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
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
  const expectedAggregateBand = result.scoreAvailable === false
    ? 'Undetermined'
    : result.score >= 75 ? 'Critical'
      : result.score >= 50 ? 'High'
        : result.score >= 25 ? 'Moderate'
          : 'Low';
  const bandRank = { Undetermined: -1, Low: 0, Moderate: 1, High: 2, Critical: 3 };
  const severityBand = { low: 'Low', medium: 'Moderate', high: 'High', critical: 'Critical' };
  const highestMaterialBand = severityBand[result.highestMaterialSeverity] || 'Undetermined';
  const aggregateBandMatches = result.aggregateRiskBand === expectedAggregateBand;
  const overallBandRespectsFloor = bandRank[result.riskBand] >= Math.max(bandRank[expectedAggregateBand], bandRank[highestMaterialBand]);
  const findingIntegrity = result.findings.every((finding) =>
    finding.id && finding.title && finding.recommendation && finding.verification &&
    ['critical','high','medium','low'].includes(finding.severity));
  const unresolvedIntegrity = result.unresolvedItems.every((item) =>
    item.id && item.title && item.status === 'information-required' && item.whatToConfirm && item.proof);
  const unknownIsolation = result.responses
    .filter((response) => response.unknown)
    .every((response) => response.points === 0 && response.severity === null);
  const pathIntegrity = result.attackPaths.every((path) =>
    path.id && path.title && path.narrative && path.tags.length > 0);
  const recommendationIntegrity = result.findings.length === 0 || result.recommendations.length > 0;
  const pass = validScore && safeDecision && aggregateBandMatches && overallBandRespectsFloor && findingIntegrity && unresolvedIntegrity && unknownIsolation && pathIntegrity && recommendationIntegrity;
  rows.push({
    id: `S${String(index + 1).padStart(4, '0')}`,
    customer: `${sectors[index % sectors.length]} customer ${index + 1}`,
    agent: result.agentType,
    score: result.score,
    scoreAvailable: result.scoreAvailable,
    completeness: result.assessmentCompleteness,
    unresolved: result.unresolvedItems.length,
    band: result.riskBand,
    decision: result.decision,
    findings: result.findings.length,
    attackPaths: result.attackPaths.length,
    criticalPath,
    checks: { validScore, safeDecision, aggregateBandMatches, overallBandRespectsFloor, findingIntegrity, unresolvedIntegrity, unknownIsolation, pathIntegrity, recommendationIntegrity },
    pass,
  });
}

const failures = rows.filter((row) => !row.pass);
const scoredRows = rows.filter((row) => row.scoreAvailable !== false);
const summary = {
  release,
  seed: '0x5a17c0de',
  generatedAt: new Date().toISOString(),
  scenarios: rows.length,
  passed: rows.length - failures.length,
  failed: failures.length,
  incomplete: rows.filter((row) => row.scoreAvailable === false).length,
  unsafeDecisions: rows.filter((row) => !row.checks.safeDecision).length,
  criticalPathScenarios: rows.filter((row) => row.criticalPath).length,
  averageScore: scoredRows.length ? Math.round(scoredRows.reduce((sum, row) => sum + row.score, 0) / scoredRows.length) : null,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/AgentRiskLayer-v${release}-1000-scenario-results.json`, `${JSON.stringify({ summary, scenarios: rows }, null, 2)}\n`);
fs.writeFileSync(`${outDir}/AgentRiskLayer-v${release}-1000-scenario-report.md`, `# AgentRiskLayer v${release} — 1,000-scenario gate

Generated: ${summary.generatedAt}

- Scenarios: **${summary.scenarios}**
- Passed: **${summary.passed}**
- Failed: **${summary.failed}**
- Incomplete/undetermined assessments: **${summary.incomplete}**
- Critical-path scenarios: **${summary.criticalPathScenarios}**
- Unsafe deployment decisions: **${summary.unsafeDecisions}**
- Average score across scoreable assessments: **${summary.averageScore === null ? 'not applicable' : `${summary.averageScore}/100`}**
- Deterministic seed: \`${summary.seed}\`

## Release gate

${summary.failed === 0 ? '**PASS.** All deterministic safety and integrity invariants passed.' : '**FAIL.** The candidate must not be released until every failing invariant is corrected.'}

## What this proves

The packaged assessment engine handled 1,000 reproducible combinations without invalid scores, aggregate-score band inconsistencies, an overall risk band below the highest declared finding or attack-path severity, malformed findings, malformed information gaps, unknown answers being scored as vulnerabilities, or a deployment-permitting decision when a critical attack path existed.

## Limits

This is synthetic functional/security testing. It does not prove real-customer usability, external-service reliability, legal compliance, or production capacity. Those require beta feedback and separate load/integration testing.
`);
console.log(JSON.stringify(summary));
if (failures.length) process.exitCode = 1;
