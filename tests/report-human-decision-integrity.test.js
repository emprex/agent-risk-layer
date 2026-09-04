import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/report.js';

function assessment(result) {
  return {
    id: 'asm_test',
    name: 'BossConsole',
    agent_type: 'MCP-enabled agent',
    created_at: '2026-09-03T17:37:00.000Z',
    scoring_version: 'arl-risk-v3.4',
    result_json: JSON.stringify(result),
  };
}

const baseResult = {
  score: 59,
  scoreAvailable: true,
  riskBand: 'High',
  aggregateRiskBand: 'High',
  inherentRisk: 100,
  controlGap: 34,
  evidenceConfidence: 4,
  assessmentCompleteness: 20,
  methodology: 'Unknown answers are not scored as vulnerabilities.',
  systemDescription: 'Test agent',
  unresolvedItems: Array.from({ length: 20 }, (_, i) => ({ id: `U-${i + 1}`, whatToConfirm: `Confirm item ${i + 1}`, frameworks: [] })),
  blockingEvidenceGaps: Array.from({ length: 12 }, (_, i) => ({ id: `E-${i + 1}` })),
  findings: [
    { id: 'C-01', severity: 'low', domain: 'Supply chain', title: 'Declared concern', observed: 'Owner-stated condition', recommendation: 'Conditional action', frameworks: ['OWASP LLM03 Supply Chain'] },
  ],
  controls: [{ status: 'action', domain: 'Supply chain', name: 'Declared concern', evidence: 'Supporting evidence ready - not yet linked or reviewed' }],
  responses: [],
  evidencePlanResolutions: {
    'mcp-authority': { state: 'evidence-gap', rationale: 'Runtime verification did not complete.' },
    'approval-binding': { state: 'evidence-gap', rationale: 'The full bounded matrix was not expressible.' },
  },
  deploymentDecision: {
    decision: 'hold',
    rationale: 'Evidence is not sufficient to support Proceed.',
    reviewerUserId: 'usr_test',
    recordedAt: '2026-09-04T08:27:12.498Z',
    blockersAtDecision: {
      recordedEvidenceGaps: 7,
      informationGaps: 20,
      unresolvedEvidenceQuestions: 12,
      confirmedRuntimeFailures: 0,
      blocked: true,
    },
  },
};

const criticalInspection = {
  summary: { findingsTotal: 143, technicalRisk: 100, postureScore: 0, grade: 'F', counts: { critical: 8, high: 10 } },
  findings: [{ ruleId: 'ARL-SEC-001', severity: 'critical', title: 'Potential secret committed to repository', summary: 'Secret-like material detected.', remediation: 'Rotate credential.', frameworks: [] }],
  trust: {},
};

test('recorded human Hold is never overwritten by static scanner severity', () => {
  const report = buildReport(assessment(baseResult), 'pro', criticalInspection, null);
  assert.equal(report.decision, 'HOLD');
  assert.equal(report.deploymentDecision.label, 'HOLD');
  assert.match(report.headline, /Human deployment decision: HOLD/);
  assert.match(report.headline, /Evidence is not sufficient to support Proceed/);
});

test('questionnaire concerns and static observations are not promoted into confirmed findings', () => {
  const report = buildReport(assessment(baseResult), 'pro', criticalInspection, null);
  assert.equal(report.findings.length, 0);
  assert.equal(report.findingRegister.length, 0);
  assert.equal(report.recommendations.length, 0);
  assert.equal(report.highestFindingSeverity, '');
  assert.deepEqual(report.executiveBrief.primaryThreats, []);
  assert.match(report.executiveBrief.summary, /No confirmed finding is open/);
  assert.match(report.inspection.summary.conclusion, /not confirmed assessment findings/);
  assert.match(report.inspection.findings[0].remediation, /^Possible fix if review confirms/);
});

test('report keeps evidence gaps separate and removes fake remediation phases', () => {
  const report = buildReport(assessment(baseResult), 'pro', criticalInspection, null);
  assert.equal(report.evidenceLimitations.informationGaps, 20);
  assert.equal(report.evidenceLimitations.recordedEvidenceGaps, 7);
  assert.equal(report.evidenceLimitations.unresolvedEvidenceQuestions, 12);
  assert.equal(report.evidenceLimitations.totalEvidenceLimitations, 19);
  assert.equal(report.actionPlan.some(x => /Contain confirmed immediate exposure/i.test(x.objective)), false);
  assert.equal(report.actionPlan.some(x => /Close confirmed material control gaps/i.test(x.objective)), false);
  assert.equal(report.verificationChecklist.length, 0);
  assert.equal(report.retestCriteria, null);
});

test('without an accountable human decision, the report says review required instead of inferring deployment from scanner counts', () => {
  const result = structuredClone(baseResult);
  delete result.deploymentDecision;
  const report = buildReport(assessment(result), 'pro', criticalInspection, null);
  assert.equal(report.decision, 'REVIEW REQUIRED');
  assert.match(report.headline, /No accountable human deployment decision has been recorded/);
});
