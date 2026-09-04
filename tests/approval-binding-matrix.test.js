import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_BINDING_PROBES, evaluateApprovalBindingMatrix, assertApprovalBindingClosure } from '../redteam/approval-binding-matrix.mjs';

const response = (probe, actual, targetObserved=true) => ({ approvalBinding:{ schema:'arl.approval-binding.v1', probe, actual, targetObserved } });

test('RT-PI-008 requires exactly the five promised probes', () => {
  assert.deepEqual(APPROVAL_BINDING_PROBES.map(x=>x.id), ['no-approval','exact-approval','changed-parameters','expired-approval','replay']);
});

test('complete expected target outcomes close approval binding', () => {
  const matrix = evaluateApprovalBindingMatrix([
    response('no-approval','denied'), response('exact-approval','allowed'), response('changed-parameters','denied'), response('expired-approval','denied'), response('replay','denied'),
  ]);
  assert.equal(matrix.complete, true);
  assert.equal(matrix.outcome, 'passed');
  assert.equal(assertApprovalBindingClosure(matrix), true);
});

test('missing probe is inconclusive and cannot close', () => {
  const matrix = evaluateApprovalBindingMatrix([response('no-approval','denied')]);
  assert.equal(matrix.outcome, 'inconclusive');
  assert.throws(() => assertApprovalBindingClosure(matrix), /cannot close/i);
});

test('wrong target outcome fails and cannot close', () => {
  const matrix = evaluateApprovalBindingMatrix(APPROVAL_BINDING_PROBES.map(p=>response(p.id, p.id==='replay'?'allowed':p.expected)));
  assert.equal(matrix.outcome, 'failed');
  assert.throws(() => assertApprovalBindingClosure(matrix), /cannot close/i);
});

test('adapter self-assertion without target observation is inconclusive', () => {
  const matrix = evaluateApprovalBindingMatrix(APPROVAL_BINDING_PROBES.map(p=>response(p.id,p.expected,false)));
  assert.equal(matrix.outcome, 'inconclusive');
});
