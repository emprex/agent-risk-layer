import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotBatchPlan } from '../src/agent/pilot-batch-plan.mjs';

const queue = {
  complete: true, systemSnapshotId: 'snap-1',
  lanes: {
    test_planning: [{ controlId:'ARL-KB-007',lane:'test_planning',chainStatus:'test_inconclusive' }],
    follow_up_blocked: [{ controlId:'ARL-KB-008',lane:'follow_up_blocked',chainStatus:'finding_open' }]
  }
};
const details = [
  {control:{id:'ARL-KB-007',title:'Control 7'},systemSnapshot:{id:'snap-1'},
    tests:[{id:'test-1'}],testHistory:[{id:'test-1'}], evidence:[]},
  {control:{id:'ARL-KB-008'},systemSnapshot:{id:'snap-1'},
    tests:[],evidence:[]}
];

test('pilot plan deduplicates historical tests and cannot authorise execution', () => {
  const plan = buildPilotBatchPlan(queue,details,['ARL-KB-007','ARL-KB-008']);
  assert.equal(plan.controlCount,2);
  assert.deepEqual(plan.controls[0].existingTestIds,['test-1']);
  assert.equal(plan.controls[0].executionAuthorised,false);
  assert.equal(plan.controls[1].proposedAction,'human_follow_up_only');
  assert.equal(plan.executableTests,0);
  assert.equal(plan.securityStateChanged,false);
});

test('pilot plan rejects stale snapshot and missing controls', () => {
  assert.throws(() => buildPilotBatchPlan(queue,[{...details[0],systemSnapshot:{id:'stale'}}],['ARL-KB-007']), /exact authoritative snapshot/);
  assert.throws(() => buildPilotBatchPlan(queue,details,['ARL-KB-999']), /exact authoritative snapshot/);
  assert.throws(() => buildPilotBatchPlan(queue,details,['ARL-KB-007','ARL-KB-007']), /Unique bounded/);
});
