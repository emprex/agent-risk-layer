import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotEvidenceGapMatrix } from '../src/agent/pilot-evidence-gap-matrix.mjs';

const plan={systemSnapshotId:'snap',controls:[{controlId:'ARL-KB-007',title:'Test',chainStatus:'test_inconclusive'}]};
const detail={control:{id:'ARL-KB-007'},systemSnapshot:{id:'snap'},
  testDefinition:{id:'check',requiredEvidence:['review artifact'],passCondition:'criterion must be established'},
  tests:[{id:'t',systemSnapshotId:'snap',result:'inconclusive'}],testHistory:[{id:'t',systemSnapshotId:'snap',result:'inconclusive'}],
  evidence:[{id:'e1',systemSnapshotId:'snap',retentionStatus:'active',verificationState:'unverified'},
    {id:'e2',systemSnapshotId:'other',retentionStatus:'active',verificationState:'verified'}]};
test('unverified or stale evidence cannot be considered verified current proof',()=>{
  const m=buildPilotEvidenceGapMatrix(plan,[detail]);
  assert.equal(m.controls[0].gap,'no_verified_current_evidence');
  assert.deepEqual(m.controls[0].evidence.historicalOrRetiredIds,['e2']);
  assert.equal(m.controls[0].evidence.unverifiedCurrent.length,1);
  assert.deepEqual(m.controls[0].recordedTestResults,['inconclusive']);
  assert.equal(m.controls[0].passInferred,false);
  assert.equal(m.controls[0].testAuthorised,false);
  assert.equal(m.securityStateChanged,false);
});
test('verified evidence still needs criterion-by-criterion human review',()=>{
  const m=buildPilotEvidenceGapMatrix(plan,[{...detail,evidence:[
    {id:'e3',systemSnapshotId:'snap',retentionStatus:'active',verificationState:'verified'}]}]);
  assert.equal(m.controls[0].gap,'criterion_coverage_requires_human_review');
  assert.equal(m.controls[0].passInferred,false);
});
test('mismatched snapshots are rejected',()=>{
  assert.throws(()=>buildPilotEvidenceGapMatrix(plan,[{...detail,systemSnapshot:{id:'wrong'}}]),/exact pilot snapshot/);
});
