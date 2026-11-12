import assert from 'node:assert/strict';
import test from 'node:test';
import {intelligenceDigest,canonicalJson} from '../src/canonical-intelligence-digest.mjs';
import {
 validateKb001IntegrityRequest,inspectKb001EvidenceRow,readKb001EvidenceIntegrity
} from '../desktop/enkyron-evidence-integrity.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const evidence='cei_a16a08432bdd4801b3c7aa753a9d21ea';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const snap='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const projection='b'.repeat(64),collection='a'.repeat(64);
const master={available:true,integrity:'verified',snapshot_status:'current',
  project_id:'prj_fixture',assessment_id:'asm_fixture',
  snapshot_id:snap,target_sha:sha};
const sourceReference=`frozen-git:${sha}:KB001:1:${projection}`;
const limits='UNVERIFIED STATIC METADATA ONLY; not accepted proof. | '+
 'Collector: target_identity; KB-001 requirement 1. | '+
 `Frozen Git revision: ${sha} | Collection SHA256: ${collection} | Projection SHA256: ${projection}`;
function build(){
  const descriptor={
    schema:'arl.control-evidence.v2',workspaceId:'wks_fixture',
    projectId:master.project_id,systemSnapshotId:snap,controlId:'ARL-KB-001',
    evidenceClass:'observed',sourceType:'arl_frozen_source_candidate',
    sourceReference,testExecutionId:null,runtimeEventId:null,approvalId:null,
    remediationArtifactId:null,findingId:null,remediationId:null,
    observedAt:'2026-11-12T08:26:36.290Z',collectorId:'usr_fixture',
    sourceDigest:null,sensitivityClassification:'internal',
    retentionStatus:'active',verificationState:'unverified',limitations:limits
  };
  return {id:evidence,workspace_id:descriptor.workspaceId,
    project_id:descriptor.projectId,system_snapshot_id:snap,entry_id:'ARL-KB-001',
    evidence_class:descriptor.evidenceClass,source_type:descriptor.sourceType,
    source_reference:sourceReference,test_execution_id:null,runtime_event_id:null,
    approval_id:null,remediation_artifact_id:null,finding_id:null,
    remediation_id:null,observed_at:new Date(descriptor.observedAt),
    collector_id:descriptor.collectorId,integrity_digest:intelligenceDigest(descriptor),
    descriptor_json:canonicalJson(descriptor),
    sensitivity_classification:'internal',retention_status:'active',
    verification_state:'unverified',limitations:limits
  };
}

test('KB-001 canonical descriptor recomputation succeeds but NEVER authenticates source',()=>{
  const result=inspectKb001EvidenceRow(build(),master);
  assert.equal(result.record_integrity,'descriptor_digest_consistent');
  assert.equal(result.source_reference_binding,'recorded_sha_matches_master');
  assert.equal(result.source_material_replay,'not_performed');
  assert.equal(result.original_source_authenticated,false);
  assert.equal(result.owner_approvals_verified,false);
  assert.equal(result.verification_state,'unverified');
  assert.equal(result.evidence_accepted,false);
  assert.equal(result.tests_executed,0);
  assert.equal(result.master_modified,false);
  assert.equal(result.projection_sha256,projection);
  assert.doesNotMatch(JSON.stringify(result),/sourceReference|source_reference|descriptor_json|limitations|I reviewed/);
});

test('fail closed on changed row, stale Master, false provenance or tampered digest',()=>{
  for(const scenario of [
    {row:{source_reference:`frozen-git:${"f".repeat(40)}:KB001:1:${projection}`}},
    {row:{integrity_digest:'e'.repeat(64)}},
    {row:{verification_state:'verified'}},
    {row:{system_snapshot_id:'sys_other'}},
    {row:{source_type:'runtime_log'}},
    {row:{source_reference:'file:///etc/shadow'}},
    {row:{test_execution_id:'test_1'}},
    {row:{limitations:'unrelated'}},
    {row:{descriptor_json:'{'}},
    {master:{snapshot_status:'superseded'}},
    {master:{target_sha:'f'.repeat(40)}},
  ]){
    const row={...build(),...(scenario.row||{})};
    assert.throws(()=>inspectKb001EvidenceRow(row,{...master,...scenario.master}),
      /integrity review blocked/);
  }
});

test('read-only query selects exact evidence under verified Master and never leaks descriptor',async()=>{
  const queries=[],row=build();
  const client={query:async(sql,values)=>{
    queries.push({sql,values});return {rows:[row]};
  }};
  const input={ticket_id:ticket,control_id:'ARL-KB-001',evidence_id:evidence};
  assert.deepEqual(validateKb001IntegrityRequest(input),input);
  const result=await readKb001EvidenceIntegrity(client,input,async(_client,id)=>{
    assert.equal(id,ticket);return master;
  });
  assert.equal(result.ticket_id,ticket);
  assert.deepEqual(queries[0].values,[evidence,master.project_id,snap,'ARL-KB-001']);
  assert.match(queries[0].sql,/WHERE id=\$1 AND project_id=\$2 AND system_snapshot_id=\$3/);
  assert.match(queries[0].sql,/LIMIT 1/);
  assert.equal(queries.length,1);
  assert.equal(result.record_integrity,'descriptor_digest_consistent');
  assert.doesNotMatch(JSON.stringify(result),/wks_fixture|usr_fixture|human recording rationale/);
  await assert.rejects(readKb001EvidenceIntegrity(client,input,async()=>({
    ...master,integrity:'failed'
  })),/integrity review blocked/);
  assert.equal(queries.length,1);
  for(const bad of [
    {...input,evidence_id:'cei_bad'},
    {...input,ticket_id:'bad'},
    {...input,control_id:'ARL-KB-002'}
  ])assert.throws(()=>validateKb001IntegrityRequest(bad),/integrity review blocked/);
});
