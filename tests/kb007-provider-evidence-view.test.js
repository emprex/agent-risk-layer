import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKb007ProviderEvidenceView } from '../src/agent/kb007-provider-evidence-view.mjs';

const rev='a'.repeat(40);
const snapshotId='sys-kb007';
const ref='arl_frozen_source_evidence_collection_v2:'+rev+':ARL-KB-007:'+'b'.repeat(64);
const observation={
  schema:'arl.deterministic-evidence-collection.v1',
  targetRevision:rev,
  projection:{incomplete:true,fullCollectionSha256:'d'.repeat(64)},
  requirementObservations:[
    {requirement:'provider inventory',collectors:['architecture_and_inventory'],observations:{
      architecture_and_inventory:{
        providerPackageCandidates:['openai','@modelcontextprotocol/sdk'],
        externalDestinationObservationCount:2,
        externalDestinationObservations:{items:[{destinationHash:'e'.repeat(24)}],originalCount:2,omittedCount:1,incomplete:true},
        mcpAndToolReferenceFiles:{items:[{basename:'agent.mjs',pathHash:'c'.repeat(24)}],originalCount:4,omittedCount:3,incomplete:true},
        discoveryCoverage:{completeTrackedAndTextScan:false,trackedFileScanCapped:true}
      }
    }},
    {requirement:'configuration',collectors:['source_and_configuration'],observations:{
      source_and_configuration:{configurationArtifacts:[{basename:'config.json',pathHash:'f'.repeat(24)}]}
    }}
  ]
};
const testRow={
  id:'ctx-test',controlId:'ARL-KB-007',systemSnapshotId:snapshotId,
  checkId:'ARL-CHK-007',checkDigest:'verified-digest',
  executionMethod:'arl_frozen_source_evidence_collection_v2',
  inputReference:ref,result:'inconclusive',
  observedResult:'Requirement-specific deterministic observations:\n'+JSON.stringify(observation)+
    '\nThis collection does not assert that any canonical requirement is satisfied'
};
const evidenceRow={
  id:'cei-1',controlId:'ARL-KB-007',systemSnapshotId:snapshotId,
  testExecutionId:'ctx-test',sourceReference:ref,
  sourceType:'arl_frozen_source_evidence_collection_v2',
  retentionStatus:'active',verificationState:'unverified'
};
const detail={
  control:{id:'ARL-KB-007'},
  systemSnapshot:{id:snapshotId,assessmentConfiguration:{targetBinding:{revision:rev}}},
  testDefinition:{id:'ARL-CHK-007',digest:'verified-digest'},
  tests:[testRow],evidence:[evidenceRow]
};
test('KB-007 reveals candidates and honest source coverage without granting authority',()=>{
  const view=buildKb007ProviderEvidenceView(detail,rev);
  assert.equal(view.observedEvidence.length,1);
  const current=view.observedEvidence[0];
  assert.deepEqual(current.packages,['openai','@modelcontextprotocol/sdk']);
  assert.equal(current.destinationCount,2);
  assert.deepEqual(current.destinationHashes,['e'.repeat(24)]);
  assert.equal(current.mcpToolReferenceCount,4);
  assert.equal(current.mcpToolReferences[0].pathHash,'c'.repeat(24));
  assert.equal(current.partialProjection,true);
  assert.equal(current.sourceCoverage.completeTrackedAndTextScan,false);
  assert.equal(current.verificationState,'unverified');
  assert.equal(view.securityStateChanged,false);
  assert.equal(view.deploymentDecisionWritten,false);
  assert.equal(view.humanReviewRequired,true);
});
test('KB-007 view rejects foreign stale or forged evidence rather than mixing source records',()=>{
  assert.throws(()=>buildKb007ProviderEvidenceView(detail,'f'.repeat(40)),/exact frozen binding/);
  assert.equal(buildKb007ProviderEvidenceView({...detail,evidence:[{...evidenceRow,sourceReference:'other'}]},rev).observedEvidence.length,0);
  assert.equal(buildKb007ProviderEvidenceView({...detail,tests:[{...testRow,checkDigest:'old'}]},rev).observedEvidence.length,0);
  assert.equal(buildKb007ProviderEvidenceView({...detail,evidence:[{...evidenceRow,systemSnapshotId:'previous'}]},rev).observedEvidence.length,0);
});
