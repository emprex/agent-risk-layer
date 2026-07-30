import test from 'node:test';
import assert from 'node:assert/strict';
import { authoriseWorkspaceAction, issueApproval, runtimeApprovalActionDigest, verifyApproval } from '../src/access-control.js';

test('workspace RBAC prevents cross-tenant and excessive actions', () => {
  const analyst={workspaceId:'w1',role:'analyst'};
  assert.equal(authoriseWorkspaceAction(analyst,'assessment:run',{workspaceId:'w1'}).allowed,true);
  assert.equal(authoriseWorkspaceAction(analyst,'member:delete',{workspaceId:'w1'}).allowed,false);
  assert.equal(authoriseWorkspaceAction(analyst,'assessment:read',{workspaceId:'w2'}).reason,'workspace-boundary');
});

test('approval tokens are signed, expiring and bound to the exact project action', () => {
  const secret='correct-horse-battery-staple-plus-more';
  const actionDigest=runtimeApprovalActionDigest({ workspaceId:'w1', projectId:'p1', environment:'production', tool:'refund_order', arguments:{ orderId:'demo_order_4821', amountPence:17500 } });
  const token=issueApproval({ approvalId:'apr_1', workspaceId:'w1', projectId:'p1', actionDigest, tool:'refund_order', environment:'production' },secret,60);
  const expected={ approvalId:'apr_1', workspaceId:'w1', projectId:'p1', actionDigest, tool:'refund_order', environment:'production' };
  const valid=verifyApproval(token,expected,secret);
  assert.equal(valid.valid,true);
  assert.equal(Object.hasOwn(valid.approval,'approverId'),false);
  assert.equal(verifyApproval(token,{...expected,actionDigest:'a'.repeat(64)},secret).valid,false);
  assert.equal(verifyApproval(`${token}x`,{},secret).valid,false);
  assert.equal(verifyApproval(token,expected,secret,Date.parse(valid.approval.expiresAt)+1).reason,'expired');
});

test('action digests are canonical but change with target or value', () => {
  const base={ workspaceId:'w1', projectId:'p1', environment:'production', tool:'refund_order' };
  const first=runtimeApprovalActionDigest({...base,arguments:{orderId:'demo_order_4821',amountPence:17500}});
  const reordered=runtimeApprovalActionDigest({...base,arguments:{amountPence:17500,orderId:'demo_order_4821'}});
  const changedAmount=runtimeApprovalActionDigest({...base,arguments:{orderId:'demo_order_4821',amountPence:17600}});
  const changedTarget=runtimeApprovalActionDigest({...base,arguments:{orderId:'demo_order_9999',amountPence:17500}});
  assert.equal(first,reordered);
  assert.notEqual(first,changedAmount);
  assert.notEqual(first,changedTarget);
});
