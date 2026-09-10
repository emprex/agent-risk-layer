import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEvidencePlan
} from '../public/evidence-plan.js';

const inspection = {
  id: 'phase4-source-evidence'
};

test('audit reconstruction without an executable case remains manual evidence', () => {
  const plan = buildEvidencePlan({
    assessment: {
      result: {
        blockingEvidenceGaps: [
          {
            questionId: 'logging',
            title: 'Audit coverage cannot reconstruct a decision'
          }
        ]
      }
    },
    inspections: [inspection]
  });

  assert.equal(plan.state, 'manual-evidence-required');
  assert.equal(plan.checks.length, 0);
  assert.equal(plan.manual.length, 1);
});

test('executable checks remain bounded while non-executable checks remain manual', () => {
  const plan = buildEvidencePlan({
    assessment: {
      result: {
        blockingEvidenceGaps: [
          {
            questionId: 'egress_control',
            title: 'Network tools permit unsafe egress'
          },
          {
            questionId: 'logging',
            title: 'Audit coverage cannot reconstruct a decision'
          }
        ]
      }
    },
    inspections: [inspection]
  });

  assert.equal(plan.state, 'bounded-check-required');
  assert.equal(plan.checks.length, 1);
  assert.equal(plan.checks[0].id, 'egress-boundary');
  assert.equal(plan.checks[0].caseId, 'RT-TOOL-004');

  assert.equal(plan.manual.length, 1);
  assert.equal(plan.manual[0].questionId, 'logging');
});

test('every emitted bounded runtime check has an executable case id', () => {
  const plan = buildEvidencePlan({
    assessment: {
      result: {
        blockingEvidenceGaps: [
          { title: 'Verify MCP tool authority' },
          { title: 'Verify exact approval binding' },
          { title: 'Verify memory isolation' },
          { title: 'Verify outbound network egress' },
          { title: 'Verify kill switch containment recovery' },
          { title: 'Verify audit reconstruction logging' }
        ]
      }
    },
    inspections: [inspection]
  });

  assert.ok(plan.checks.length > 0);

  for (const check of plan.checks) {
    assert.equal(
      typeof check.caseId,
      'string',
      `${check.id} was emitted as a bounded check without a caseId`
    );
    assert.ok(check.caseId.length > 0);
  }
});
