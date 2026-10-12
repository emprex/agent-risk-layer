import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyIncompleteV2Source } from '../src/agent/tools/run-authoritative-control-test.mjs';

const revision = 'a'.repeat(40);
const controlId = 'ARL-KB-023';
const checkId = 'ARL-CHK-023';
const checkDigest = 'b'.repeat(64);
const snapshotId = 'sys_reference';
const identity = {revision,controlId,checkId,checkDigest,snapshotId};
const record = {
  controlId,checkId,checkDigest,systemSnapshotId:snapshotId,
  executionMethod:'arl_frozen_source_evidence_collection_v2',
  result:'inconclusive',executionKind:'initial',
  inputReference:['arl_frozen_source_evidence_collection_v2',revision,controlId,'c'.repeat(64)].join(':'),
  observedResult:'Legacy frozen-source summary'.repeat(100).slice(0,2000)
};
const completePayload = {
  schema:'arl.deterministic-evidence-collection.v1',
  targetRevision:revision,
  requirementObservations:[]
};
const complete = {
  ...record,
  observedResult:[
    'Requirement-specific deterministic observations:',
    JSON.stringify(completePayload),
    'This collection does not assert that any canonical requirement is satisfied'
  ].join('\n')
};

test('recover missing structured observation only on exact frozen control/check/snapshot', () => {
  assert.equal(isLegacyIncompleteV2Source(record,identity),true);
  assert.equal(isLegacyIncompleteV2Source({...record,systemSnapshotId:'different'},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,checkDigest:'stale'},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,checkId:'different'},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,result:'passed'},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,executionKind:'retest'},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,inputReference:record.inputReference.replace(revision,'d'.repeat(40))},identity),false);
  assert.equal(isLegacyIncompleteV2Source({...record,inputReference:record.inputReference.replace(controlId,'ARL-KB-031')},identity),false);
});

test('no recovery when complete valid structured evidence already exists', () => {
  assert.equal(isLegacyIncompleteV2Source(complete,identity),false);
});

test('truncated or malformed structured payload remains recoverable', () => {
  assert.equal(isLegacyIncompleteV2Source({...complete,observedResult:complete.observedResult.slice(0,-15)},identity),true);
  assert.equal(isLegacyIncompleteV2Source({...complete,observedResult:complete.observedResult.replace(JSON.stringify(completePayload),'{bad')},identity),true);
});

test('reject request without valid control identity', () => {
  assert.equal(isLegacyIncompleteV2Source(record,{...identity,controlId:'KB-023'}),false);
  assert.equal(isLegacyIncompleteV2Source(record,{...identity,revision:'bad'}),false);
});
