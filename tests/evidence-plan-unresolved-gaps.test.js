import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePlan } from '../public/evidence-plan.js';

const inspection = { id: 'ins_static', createdAt: '2026-09-03T18:16:47Z' };

test('unresolvedItems remain material after source evidence and map to bounded checks', () => {
  const assessment = {
    result: {
      unresolvedItems: [
        { id: 'U-01', title: 'How is human approval enforced for high-impact actions?' },
        { id: 'U-02', title: 'How is outbound network egress controlled?' },
        { id: 'U-03', title: 'How is agent memory isolated between users?' },
        { id: 'U-04', title: 'Can the agent be stopped with a kill switch and recovered safely?' },
        { id: 'U-05', title: 'Can logs reconstruct what the agent saw and changed?' },
        { id: 'U-06', title: 'What sensitive business data can the agent access?' },
      ],
    },
  };

  const plan = buildEvidencePlan({ assessment, inspections: [inspection] });
  assert.equal(plan.state, 'bounded-check-required');
  assert.deepEqual(plan.checks.map((item) => item.id), [
    'approval-binding',
    'egress-boundary',
    'memory-isolation',
    'containment-recovery',
    'audit-reconstruction',
  ]);
  assert.equal(plan.manual.length, 1);
  assert.equal(plan.manual[0].id, 'U-06');
});

test('blockingInformationGaps do not disappear after source evidence', () => {
  const assessment = {
    result: {
      blockingInformationGaps: [
        { id: 'U-11', title: 'What permissions and MCP tools can the agent use?' },
      ],
    },
  };
  const plan = buildEvidencePlan({ assessment, inspections: [inspection] });
  assert.equal(plan.state, 'bounded-check-required');
  assert.equal(plan.checks[0].id, 'mcp-authority');
});

test('unresolved controls remain evidence gaps when no exact unresolved list is present', () => {
  const assessment = {
    controls: [
      { id: 'logging', name: 'Audit logging and reconstruction', status: 'unresolved' },
      { id: 'owner', name: 'Accountable owner', status: 'verified' },
    ],
  };
  const plan = buildEvidencePlan({ assessment, inspections: [inspection] });
  assert.equal(plan.state, 'bounded-check-required');
  assert.equal(plan.checks[0].id, 'audit-reconstruction');
});
