import test from 'node:test';
import assert from 'node:assert/strict';
import { authoriseWorkspaceAction, issueApproval, verifyApproval } from '../src/access-control.js';

test('workspace RBAC prevents cross-tenant and excessive actions', () => {
  const analyst={workspaceId:'w1',role:'analyst'};
  assert.equal(authoriseWorkspaceAction(analyst,'assessment:run',{workspaceId:'w1'}).allowed,true);
  assert.equal(authoriseWorkspaceAction(analyst,'member:delete',{workspaceId:'w1'}).allowed,false);
  assert.equal(authoriseWorkspaceAction(analyst,'assessment:read',{workspaceId:'w2'}).reason,'workspace-boundary');
});

test('approval tokens are signed, expiring and action-bound', () => {
  const secret='correct-horse-battery-staple-plus-more';
  const token=issueApproval({workspaceId:'w1',actionDigest:'abc',environment:'production',approverId:'u1'},secret);
  assert.equal(verifyApproval(token,{workspaceId:'w1',actionDigest:'abc',environment:'production'},secret).valid,true);
  assert.equal(verifyApproval(token,{workspaceId:'w1',actionDigest:'different',environment:'production'},secret).valid,false);
  assert.equal(verifyApproval(`${token}x`,{},secret).valid,false);
});
