import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKb008PrivacyEvidenceView} from '../src/agent/kb008-privacy-evidence-view.mjs';

const rev='a'.repeat(40), snapshotId='sys-test';
const ref='arl_frozen_source_evidence_collection_v2:'+rev+':ARL-KB-008:'+'b'.repeat(64);
const payload={schema:'arl.deterministic-evidence-collection.v1',targetRevision:rev,
  projection:{incomplete:true},requirementObservations:[
  {collectors:['target_identity'],observations:{target_identity:{targetRevision:rev}}},
  {collectors:['data_and_capability_observation'],observations:{data_and_capability_observation:{
    mcpAndToolReferenceFiles:[{basename:'service.py',pathHash:'c'.repeat(24)}],
    externalDestinationObservations:[{destinationHash:'d'.repeat(24),observedIn:{basename:'service.py'}}],
    credentialReferenceFiles:[{basename:'settings.py',pathHash:'e'.repeat(24)}]
  }}},
  {collectors:['policy_and_documentation'],observations:{policy_and_documentation:{
    policyArtifacts:[{basename:'privacy.md',pathHash:'f'.repeat(24)}]
  }}}
]};
const testRow={id:'ctx-test',controlId:'ARL-KB-008',systemSnapshotId:snapshotId,
  inputReference:ref,executionMethod:'arl_frozen_source_evidence_collection_v2',
  checkId:'ARL-CHK-008',checkDigest:'check-digest',result:'inconclusive',
  observedResult:'Requirement-specific deterministic observations:\n'+JSON.stringify(payload)+
    '\nThis collection does not assert that any canonical requirement is satisfied'};
const evidenceRow={id:'cei-test',controlId:'ARL-KB-008',systemSnapshotId:snapshotId,
  testExecutionId:'ctx-test',sourceReference:ref,sourceType:'arl_frozen_source_evidence_collection_v2',
  retentionStatus:'active',verificationState:'unverified'};
const detail={control:{id:'ARL-KB-008'},
  systemSnapshot:{id:snapshotId,assessmentConfiguration:{targetBinding:{revision:rev}}},
  testDefinition:{id:'ARL-CHK-008',digest:'check-digest'},
  tests:[testRow],evidence:[evidenceRow]};
test('KB-008 view shows bounded references but cannot assert privacy compliance',()=>{
 const view=buildKb008PrivacyEvidenceView(detail,rev);
 assert.equal(view.observedEvidence.length,1);
 assert.deepEqual(view.observedEvidence[0].destinationHashes,['d'.repeat(24)]);
 assert.equal(view.observedEvidence[0].privacyNoticeCandidateFiles[0].basename,'privacy.md');
 assert.equal(view.observedEvidence[0].partialProjection,true);
 assert.equal(view.finding,'NOT_DETERMINED');
 assert.equal(view.securityStateChanged,false);
 assert.equal(view.humanReviewRequired,true);
});
test('KB-008 rejects unbound, stale, conflicting check and forged source references',()=>{
 assert.throws(()=>buildKb008PrivacyEvidenceView(detail,'e'.repeat(40)),/exact authoritative/);
 assert.equal(buildKb008PrivacyEvidenceView({...detail,tests:[{...testRow,checkDigest:'old'}]},rev).observedEvidence.length,0);
 assert.equal(buildKb008PrivacyEvidenceView({...detail,evidence:[{...evidenceRow,sourceReference:'forged'}]},rev).observedEvidence.length,0);
 assert.equal(buildKb008PrivacyEvidenceView({...detail,evidence:[{...evidenceRow,systemSnapshotId:'old'}]},rev).observedEvidence.length,0);
});
