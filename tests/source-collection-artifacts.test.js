import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {serializeSourceCollection,verifySourceCollectionArtifact} from '../src/agent/tools/source-collection-artifacts.mjs';

const revision='a'.repeat(40);
const base={
  schema:'arl.deterministic-evidence-collection.v1',
  targetRevision:revision,
  privacyBoundary:'No source code, secret values, credential values or raw external destination names are included.',
  requirementObservations:[{requirement:'KB-016',collectors:['target_identity'],observations:{target_identity:{revision}}}]
};
const scope={workspaceId:'ws_1',projectId:'prj_1',snapshotId:'sys_1',controlId:'ARL-KB-016',
  targetRevision:revision,inputReference:'arl_frozen_source_evidence_collection_v2:'+revision+':ARL-KB-016:'+'b'.repeat(64)};
function rowFor(collection=base) {
  const {json,digest}=serializeSourceCollection(collection,{targetRevision:revision});
  return {workspace_id:scope.workspaceId,project_id:scope.projectId,
    system_snapshot_id:scope.snapshotId,entry_id:scope.controlId,target_revision:revision,
    input_reference:scope.inputReference,collection_json:json,collection_sha256:digest,retention_status:'active',retention_expires_at:null};
}
test('complete source collection has stable SHA-256 and retains every inventory member',()=>{
  const complete={...base,requirementObservations:[{requirement:'KB-016',
    collectors:['dependency_and_build'],observations:{dependency_and_build:{
      lockfiles:Array.from({length:40},(_,i)=>({basename:'requirements.txt',pathHash:String(i).padStart(24,'0')}))
    }}}]};
  const row=rowFor(complete);
  assert.equal(row.collection_sha256,crypto.createHash('sha256').update(JSON.stringify(complete)).digest('hex'));
  assert.equal(verifySourceCollectionArtifact(row,scope).requirementObservations[0].observations.dependency_and_build.lockfiles.length,40);
  assert.deepEqual(serializeSourceCollection(complete,{targetRevision:revision,projectionDigest:row.collection_sha256}).json, row.collection_json);
  assert.throws(()=>serializeSourceCollection(complete,{targetRevision:revision,projectionDigest:'f'.repeat(64)}),/digest/);
});
test('wrong scope cannot read an artifact',()=>{
  const row=rowFor();
  for(const name of ['workspaceId','projectId','snapshotId','controlId','targetRevision','inputReference']) {
    assert.throws(()=>verifySourceCollectionArtifact(row,{...scope,[name]:'wrong'}),/scope/);
  }
  assert.throws(()=>verifySourceCollectionArtifact(null,scope),/missing/);
});
test('changed payload, digest and malformed payload fail integrity validation',()=>{
  const row=rowFor();
  assert.throws(()=>verifySourceCollectionArtifact({...row,collection_json:row.collection_json+' '},scope),/integrity/);
  assert.throws(()=>verifySourceCollectionArtifact({...row,collection_sha256:'0'.repeat(64)},scope),/integrity/);
  assert.throws(()=>verifySourceCollectionArtifact({...row,collection_json:'{}'},scope),/integrity/);
});
test('reject wrong frozen revision and missing privacy-boundary declaration',()=>{
  assert.throws(()=>serializeSourceCollection({...base,targetRevision:'b'.repeat(40)},{targetRevision:revision}),/identity/);
  assert.throws(()=>serializeSourceCollection({...base,privacyBoundary:''},{targetRevision:revision}),/privacy/);
});

test('expired artifacts are unavailable; explicit retention hold preserves review access',()=>{
  const row=rowFor();
  assert.throws(()=>verifySourceCollectionArtifact({...row,retention_status:'expired'},scope),/retained/);
  assert.throws(()=>verifySourceCollectionArtifact({...row,retention_expires_at:'2020-01-01T00:00:00Z'},scope),/expired/);
  assert.deepEqual(verifySourceCollectionArtifact({...row,retention_status:'retained_hold',retention_expires_at:'2020-01-01T00:00:00Z'},scope),base);
});
