import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

function answersAt(optionIndex, evidence = 'automatically_tested') {
  return Object.fromEntries(questionnaire.map((q) => [q.id, { value: q.options[optionIndex].value, evidence }]));
}

function allUnknown() {
  return Object.fromEntries(questionnaire.map((q) => [q.id, { value: 'unknown', evidence: 'none' }]));
}

test('hardened and tested configuration scores as low risk', () => {
  const result = evaluateAssessment(answersAt(0));
  assert.ok(result.score < 10);
  assert.equal(result.riskBand, 'Low');
  assert.equal(result.findings.length, 0);
  assert.equal(result.unresolvedItems.length, 0);
  assert.equal(result.evidenceConfidence, 85);
  assert.equal(result.decision, 'PROCEED WITH MONITORING');
});

test('maximum-risk configuration scores as critical', () => {
  const result = evaluateAssessment(answersAt(3, 'none'));
  assert.equal(result.score, 100);
  assert.equal(result.riskBand, 'Critical');
  assert.ok(result.findings.length >= 10);
  assert.ok(result.recommendations.some((item) => item.priority === 'Immediate'));
  assert.equal(result.decision, 'DO NOT DEPLOY');
});

test('critical attack path always overrides aggregate score and blocks deployment', () => {
  const answers = answersAt(0);
  answers.external_content = { value: 'open', evidence: 'tested' };
  answers.input_boundary = { value: 'none', evidence: 'tested' };
  answers.tool_scope = { value: 'privileged', evidence: 'tested' };
  const result = evaluateAssessment(answers);
  assert.ok(result.attackPaths.some((path) => path.severity === 'critical'));
  assert.equal(result.decision, 'DO NOT DEPLOY');
});

test('exposure describes context and does not become a finding by itself', () => {
  const answers = answersAt(0);
  answers.data_sensitivity = { value: 'regulated', evidence: 'customer_assertion' };
  answers.business_impact = { value: 'severe', evidence: 'customer_assertion' };
  const result = evaluateAssessment(answers);
  assert.equal(result.findings.length, 0);
  assert.ok(result.inherentRisk > 0);
});

test('moderate configuration produces control findings and attack paths', () => {
  const answers = answersAt(1, 'documented');
  answers.permissions = { value: 'user', evidence: 'documented' };
  answers.external_content = { value: 'mixed', evidence: 'documented' };
  answers.input_boundary = { value: 'prompt-only', evidence: 'claimed' };
  answers.tool_scope = { value: 'broad', evidence: 'documented' };
  const result = evaluateAssessment(answers, { agentType: 'Email agent' });
  assert.ok(result.score >= 25 && result.score < 75);
  assert.ok(['Moderate', 'High'].includes(result.riskBand));
  assert.ok(result.topFindings.length <= 3);
  assert.ok(result.findings.every((finding) => finding.recommendation && finding.verification));
  assert.ok(result.attackPaths.length >= 1);
  assert.ok(result.controls.some((control) => control.status === 'action'));
});

test('unsupported safe control claims require evidence without inflating declared risk', () => {
  const result = evaluateAssessment(answersAt(0, 'customer_assertion'));
  assert.equal(result.riskBand, 'Low');
  assert.equal(result.evidenceConfidence, 20);
  assert.equal(result.score, 0);
  assert.equal(result.decision, 'HOLD FOR EVIDENCE');
  assert.ok(result.blockingEvidenceGaps.length > 0);
});

test('legacy tested selections are treated as unsupported customer assertions', () => {
  const result = evaluateAssessment(answersAt(0, 'tested'));
  assert.equal(result.evidenceConfidence, 20);
  assert.equal(result.decision, 'HOLD FOR EVIDENCE');
  assert.ok(result.controls.every((control) => control.verified === false));
});

test('unknown answers are unresolved information, not vulnerabilities or critical risk', () => {
  const result = evaluateAssessment(allUnknown(), { agentType: 'Other' });
  assert.equal(result.score, 0);
  assert.equal(result.scoreAvailable, false);
  assert.equal(result.riskBand, 'Undetermined');
  assert.equal(result.decision, 'HOLD FOR INFORMATION');
  assert.equal(result.findings.length, 0);
  assert.equal(result.attackPaths.length, 0);
  assert.equal(result.unresolvedItems.length, questionnaire.length);
  assert.equal(result.assessmentCompleteness, 0);
  assert.equal(result.evidenceConfidence, 0);
  assert.match(result.headline, /No vulnerability is inferred/i);
  assert.ok(result.unresolvedItems.every((item) => item.whatToConfirm && item.proof));
});

test('mixed known and unknown answers keep real findings separate from information gaps', () => {
  const answers = answersAt(0, 'customer_assertion');
  answers.permissions = { value: 'user', evidence: 'customer_assertion' };
  answers.memory_security = { value: 'unknown', evidence: 'none' };
  const result = evaluateAssessment(answers);
  assert.ok(result.findings.some((finding) => finding.title.includes('permissions')));
  assert.ok(result.unresolvedItems.some((item) => item.questionId === 'memory_security'));
  assert.equal(result.decision, 'HOLD FOR INFORMATION');
});

test('not-applicable control choices do not create findings or risk points', () => {
  const answers = answersAt(0, 'customer_assertion');
  answers.credentials = { value: 'not-used', evidence: 'customer_assertion' };
  answers.tool_authorization = { value: 'not-applicable', evidence: 'customer_assertion' };
  answers.human_approval = { value: 'not-applicable', evidence: 'customer_assertion' };
  answers.output_validation = { value: 'display-only', evidence: 'customer_assertion' };
  answers.memory_security = { value: 'not-applicable', evidence: 'customer_assertion' };
  answers.egress_control = { value: 'not-applicable', evidence: 'customer_assertion' };
  const result = evaluateAssessment(answers);
  assert.equal(result.findings.length, 0);
  assert.ok(result.controls.some((control) => control.applicability === 'not-applicable-claimed'));
  assert.equal(result.decision, 'HOLD FOR EVIDENCE');
});

test('system description is retained in the assessment result but not interpreted as evidence', () => {
  const answers = answersAt(0, 'customer_assertion');
  answers.__system_description = 'Adaptive planning system with persistent memory.';
  const result = evaluateAssessment(answers, { agentType: 'Autonomous / general-purpose agent' });
  assert.equal(result.systemDescription, 'Adaptive planning system with persistent memory.');
  assert.equal(result.evidenceConfidence, 20);
});

test('invalid or missing answer is rejected', () => {
  assert.throws(() => evaluateAssessment({}), /Missing or invalid answer/);
});
