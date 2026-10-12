import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNextLegacyV2RecoveryBatch } from '../src/agent/legacy-v2-recovery-batch-plan.mjs';

function review(exceptions) {
  return {summary:{lineageExceptions:exceptions.length},lineageExceptions:exceptions};
}
const eligible = n => ({
  controlId:'ARL-KB-' + String(n).padStart(3,'0'),
  lineageStatus:'structured_observation_missing',
  diagnosticLane:'bounded_recollection_candidate_manual_authorisation_required'
});

test('selects at most 20 unique currently eligible controls deterministically',()=>{
  const entries = Array.from({length:25},(_,i)=>eligible(25-i));
  entries.push(eligible(1));
  entries.push({controlId:'ARL-KB-026',lineageStatus:'source_test_or_check_lineage_mismatch',
    diagnosticLane:'lineage_or_integrity_manual_investigation_required'});
  const first=selectNextLegacyV2RecoveryBatch(review(entries));
  assert.equal(first.eligibleControls,25);
  assert.deepEqual(first.selectedControls,Array.from({length:20},(_,i)=>eligible(i+1).controlId));
  const remaining=selectNextLegacyV2RecoveryBatch(review(entries.slice(0,5)));
  assert.deepEqual(remaining.selectedControls,Array.from({length:5},(_,i)=>eligible(25-i).controlId).sort());
});

test('refuses incomplete inventories, excessive batch size and forged control identity',()=>{
  assert.throws(()=>selectNextLegacyV2RecoveryBatch({summary:{lineageExceptions:2},lineageExceptions:[eligible(1)]}),/Complete bounded/);
  assert.throws(()=>selectNextLegacyV2RecoveryBatch(review([eligible(1)]),21),/Complete bounded/);
  assert.deepEqual(selectNextLegacyV2RecoveryBatch(review([{...eligible(1),controlId:'broken'}])).selectedControls,[]);
});
