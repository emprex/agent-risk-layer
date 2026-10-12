import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScopedControlState } from '../src/agent/authoritative-workflow-state.mjs';

function item(controlId, disposition=null) {
  return {controlId,currentStage:'test',chainStatus:'test_inconclusive',
    operationalReviewDisposition:disposition};
}
const readiness = {summary:{profileControls:108}};
const queue = {items:[
  {controlId:'ARL-KB-007',classification:'human_only'},
  {controlId:'ARL-KB-008',classification:'human_only'}
]};

test('108-control selector advances KB-007 to KB-008 only after administrative disposition',()=>{
  const before = selectScopedControlState(
    {items:[item('ARL-KB-007'),item('ARL-KB-008')]},[],readiness,queue);
  assert.equal(before.controlId,'ARL-KB-007');
  const after = selectScopedControlState(
    {items:[item('ARL-KB-007','inconclusive_documented'),item('ARL-KB-008')]},
    [],readiness,queue);
  assert.equal(after.controlId,'ARL-KB-008');
  assert.equal(after.chainStatus,'test_inconclusive');
});

test('non-administrative decisions cannot silently remove a control from the queue',()=>{
  for(const disposition of [null,'passed','failed','review_pending']) {
    const selected=selectScopedControlState(
      {items:[item('ARL-KB-007',disposition),item('ARL-KB-008')]},[],readiness,queue);
    assert.equal(selected.controlId,'ARL-KB-007');
  }
});
