import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';

test('read-only work queue retains held findings while surfacing independent controls', () => {
  const pages = [
    { systemSnapshot: { id: 'snapshot-1' }, total: 3, items: [
      { controlId: 'ARL-KB-006', chainStatus: 'finding_open', currentStage: 'remediation', deploymentImpact: 'blocker' },
      { controlId: 'ARL-KB-007', chainStatus: 'test_required', currentStage: 'test' }
    ] },
    { systemSnapshot: { id: 'snapshot-1' }, total: 3, items: [
      { controlId: 'ARL-KB-007', currentStage: 'test' },
      { controlId: 'ARL-KB-008', currentStage: 'evidence' }
    ] }
  ];
  const queue = buildControlWorkQueue(pages);
  assert.equal(queue.total, 3);
  assert.equal(queue.complete, true);
  assert.deepEqual(queue.lanes.follow_up_blocked.map(x => x.controlId), ['ARL-KB-006']);
  assert.deepEqual(queue.lanes.test_planning.map(x => x.controlId), ['ARL-KB-007']);
  assert.deepEqual(queue.lanes.evidence_collection.map(x => x.controlId), ['ARL-KB-008']);
  assert.equal(queue.securityStateChanged, false);
  assert.equal(queue.deploymentDecisionWritten, false);
});

test('work queue refuses mixed snapshots', () => {
  assert.throws(() => buildControlWorkQueue([
    { systemSnapshot: { id: 'snapshot-1' }, items: [] },
    { systemSnapshot: { id: 'snapshot-2' }, items: [] }
  ]), /Snapshot changed/);
});

test('work queue never silently claims complete coverage', () => {
  const queue = buildControlWorkQueue([{ systemSnapshot: { id: 'snapshot-1' }, total: 108, items: [
    {controlId: 'ARL-KB-006', currentStage: 'remediation'}
  ]}]);
  assert.equal(queue.complete, false);
});
