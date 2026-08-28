import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSPECTOR_DEPENDENCY_COUNTING_SEMANTICS,
  dependencyAssessmentToInspectorEvidence,
} from '../inspector/dependency-vulnerability-evidence.mjs';

test('Inspector dependency evidence exposes inventory count semantics explicitly', () => {
  const result = dependencyAssessmentToInspectorEvidence({
    status: 'completed',
    ecosystem: 'multiple',
    ecosystems: ['Pub', 'npm'],
    lockfilesExamined: 2,
    lockedDependenciesExamined: 109,
    findings: [],
    intelligence: null,
  });

  assert.equal(result.lockedDependenciesExamined, 109);
  assert.equal(result.inventoryCount, 109);
  assert.equal(result.countingSemantics, INSPECTOR_DEPENDENCY_COUNTING_SEMANTICS);
  assert.match(result.countingSemantics, /external advisory scanners may use different extraction/i);
});
