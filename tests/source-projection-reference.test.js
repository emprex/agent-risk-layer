import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceProjectionRefreshReference} from '../src/agent/source-projection-reference.mjs';

const revision='b'.repeat(40), check='c'.repeat(64);
const base=()=>({schema:'arl.deterministic-evidence-collection.v1',
 sourceProjectionRevision:'arl.source-collection-projection.v2',
 targetRevision:revision,privacyBoundary:'No source code, secret values',
 requirementObservations:[{requirement:'Scope',collectors:['target_identity'],
 observations:{target_identity:{revision}}}]
});
const ref=(collection=base(),extras={})=>buildSourceProjectionRefreshReference({
 targetRevision:revision,controlId:'ARL-KB-011',checkDigest:check,
 collection,...extras
});
test('v2 source projection references are idempotent and change for material evidence changes',()=>{
 const original=ref();
 assert.match(original,new RegExp('^arl_frozen_source_evidence_collection_v2:'+revision+':ARL-KB-011:[a-f0-9]{64}$'));
 assert.equal(ref(),original);
 assert.notEqual(ref({...base(),requirementObservations:[...base().requirementObservations,
  {requirement:'Observed source',collectors:[],observations:{}}]}),original);
 assert.notEqual(ref(base(),{checkDigest:'d'.repeat(64)}),original);
 assert.notEqual(ref(base(),{controlId:'ARL-KB-012'}),original);
});
test('v2 refresh fails closed for stale, malformed and unversioned collections',()=>{
 assert.throws(()=>ref({...base(),sourceProjectionRevision:'legacy_unversioned'}),/versioned/);
 assert.throws(()=>ref(base(),{checkDigest:'short'}),/exact authoritative/);
 assert.throws(()=>ref(base(),{targetRevision:'a'.repeat(40)}),/same-target/);
 assert.throws(()=>ref(base(),{controlId:'../ARL-KB-011'}),/same-target/);
 assert.throws(()=>ref({...base(),requirementObservations:null}),/same-target/);
});
