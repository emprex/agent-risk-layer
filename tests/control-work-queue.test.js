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
      { controlId: 'ARL-KB-007', chainStatus: 'test_required', currentStage: 'test' },
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
    { systemSnapshot: { id: 'snapshot-1' }, total: 0, items: [] },
    { systemSnapshot: { id: 'snapshot-2' }, total: 0, items: [] }
  ]), /Snapshot or control count changed/);
});

test('work queue never silently claims complete coverage', () => {
  const queue = buildControlWorkQueue([{ systemSnapshot: { id: 'snapshot-1' }, total: 108, items: [
    {controlId: 'ARL-KB-006', currentStage: 'remediation'}
  ]}]);
  assert.equal(queue.complete, false);
});


test('authoritative work queue rejects conflicting duplicate control statuses', () => {
  assert.throws(() => buildControlWorkQueue([
    {systemSnapshot:{id:'snap'},total:1,items:[
      {controlId:'ARL-KB-006',currentStage:'remediation',chainStatus:'finding_open'}
    ]},
    {systemSnapshot:{id:'snap'},total:1,items:[
      {controlId:'ARL-KB-006',currentStage:'deployment_decision',chainStatus:'satisfied'}
    ]}
  ]),/Conflicting duplicate/);
});

test('authoritative queue rejects changes in total and unfinished pagination',()=>{
  assert.throws(()=>buildControlWorkQueue([
    {systemSnapshot:{id:'snap'},total:1,items:[],hasMore:true},
    {systemSnapshot:{id:'snap'},total:2,items:[],hasMore:false}
  ]),/Snapshot or control count/);
  assert.throws(()=>buildControlWorkQueue([
    {systemSnapshot:{id:'snap'},total:1,items:[
      {controlId:'ARL-KB-007',currentStage:'test'}],hasMore:true}
  ]),/pagination is incomplete/);
});
