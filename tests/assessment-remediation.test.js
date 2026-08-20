import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessmentEnvironment,
  assessmentProjects,
  assessmentRemediationHref,
  linkedAssessmentRemediations,
  matchingAssessmentProject,
  remediationFindingKey,
} from '../public/assessment-remediation.js';

test('assessment remediation links retain scope without unnecessarily propagating owner tokens', () => {
  assert.equal(assessmentRemediationHref({ assessmentId: 'asm_1', token: 'access_1', isOwner: true }), '/control-plane.html?assessment=asm_1#remediation');
  assert.equal(assessmentRemediationHref({ assessmentId: 'asm_1', token: 'access_1', isOwner: false }), '/control-plane.html?assessment=asm_1&token=access_1#remediation');
});

test('assessment handoff never silently selects an unrelated project', () => {
  const overview = {
    projects: [{ id: 'prj_runtime', name: 'Production Evidence Verification' }],
    assessmentCases: { projects: [{ id: 'prj_case', name: 'Northstar Refund Assistant — staging v0.9' }] },
  };
  assert.equal(assessmentProjects(overview).length, 2);
  assert.equal(matchingAssessmentProject(overview, { name: 'Northstar Refund Assistant — staging v0.9' }).id, 'prj_case');
  assert.equal(matchingAssessmentProject(overview, { name: 'Different agent' }), null);
});

test('assessment remediation identity and environment remain bound to the assessed version', () => {
  assert.equal(assessmentEnvironment({ name: 'Northstar — staging v0.9' }), 'staging');
  assert.equal(remediationFindingKey('asm_1', { id: 'F-01' }), 'assessment:asm_1:F-01');
  assert.deepEqual(linkedAssessmentRemediations({ remediations: [
    { id: 'one', assessment_id: 'asm_1' }, { id: 'two', assessment_id: 'asm_2' },
  ] }, 'asm_1').map((item) => item.id), ['one']);
});

test('assessment remediation cannot silently resume inside a runtime project', () => {
  const runtimeProject = {
    id: 'prj_runtime',
    projectKind: 'runtime',
    assessmentId: null,
    remediations: [{ id: 'legacy', assessment_id: 'asm_1' }],
  };

  assert.deepEqual(linkedAssessmentRemediations(runtimeProject, 'asm_1'), []);
});

test('assessment remediation only resumes inside the case bound to that exact assessment', () => {
  const exactCase = {
    id: 'prj_case_exact',
    projectKind: 'assessment_case',
    assessmentId: 'asm_1',
    remediations: [{ id: 'exact', assessment_id: 'asm_1' }],
  };
  const otherCase = {
    id: 'prj_case_other',
    projectKind: 'assessment_case',
    assessmentId: 'asm_2',
    remediations: [{ id: 'wrong', assessment_id: 'asm_1' }],
  };

  assert.deepEqual(linkedAssessmentRemediations(exactCase, 'asm_1').map((item) => item.id), ['exact']);
  assert.deepEqual(linkedAssessmentRemediations(otherCase, 'asm_1'), []);
});
