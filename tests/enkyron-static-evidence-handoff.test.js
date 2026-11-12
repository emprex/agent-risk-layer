import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {
  validateKb001EvidenceRecording,kb001EvidenceReference,
  kb001EvidenceLimitations,readKb001VerifiedMaster,recordKb001StaticEvidence
} from '../desktop/enkyron-static-evidence-handoff.mjs';

const TICKET='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const SHA='129a20f42321742229ba78c3f1b13ea925ea7622';
const SNAP='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const COL='a'.repeat(64), PROJ='b'.repeat(64);
const scope={project_id:'prj_fixture',assessment_id:'asm_fixture',snapshot_id:SNAP,
  target_sha:SHA,target_reference:'/home/fixture/miniagent'};
const candidate={
  schema:'enkyron.kb001.static-identity-candidate.v1',
  control_id:'ARL-KB-001',criterion_number:1,collector:'target_identity',
  snapshot_id:SNAP,target_sha:SHA,observed_revision:SHA,
  observed_environment:null,observed_project_label:'miniagent',
  collection_sha256:COL,projection_sha256:PROJ,metadata_only:true,
  verified:false,criterion_satisfied:false
};
const input={ticket_id:TICKET,control_id:'ARL-KB-001',criterion_number:1,
  snapshot_id:SNAP,target_sha:SHA,collection_sha256:COL,projection_sha256:PROJ,
  confirmed:true,acknowledgement:'I CONFIRM UNVERIFIED SOURCE METADATA ONLY',
  rationale:'I inspected the frozen source SHA and know that the approved purpose and environment remain unverified.'};
const preview={available:true,ticket_id:TICKET,project_id:scope.project_id,
  assessment_id:scope.assessment_id,snapshot_id:SNAP,target_sha:SHA,
  collection_sha256:COL,kb001_candidate:candidate};

function fakeDeps(state={}){
  const reads={scope:0,master:0,writer:0,locks:0,unlocks:0};
  const existing=[];
  const queried=[];
  const client={
    query:async (sql,args)=>{
      queried.push({sql,args});
      if(sql.includes('pg_advisory_lock')){reads.locks++;return {rows:[]};}
      if(sql.includes('pg_advisory_unlock')){reads.unlocks++;return {rows:[]};}
      if(sql.includes('FROM control_evidence_items')&&sql.includes('LIMIT 2'))
        return {rows:state.duplicate ? [{id:'cei_preexisting',verification_state:'unverified'}] : []};
      if(sql.includes('FROM control_evidence_items')&&sql.includes('WHERE id=$1'))
        return {rows:[{id:'cei_fixture',verification_state:'unverified',retention_status:'active'}]};
      throw Error('unexpected client query '+sql);
    },
    release:()=>{}
  };
  const pool={
    query:async sql=>{
      if(!sql.includes('FROM arl_workbench_tickets'))throw Error('unexpected owner query');
      return {rows:[{assigned_to:state.wrongOwner?'another':'emprex',
        assessor_name:'emprex',status:'scoping',archived_at:null}]};
    },
    connect:async()=>client
  };
  const dependencies={
    scopeReader:async()=>{reads.scope++;return {...scope,
      ...(reads.scope===2&&state.drift?{target_sha:'f'.repeat(40)}:{})};},
    masterReader:async()=>{reads.master++;return {integrity:'verified'};},
    detailReader:async()=>({snapshot_id:SNAP,stage:'applicability',
      applicability_status:state.notApplicable?'not_applicable':'context_required'}),
    candidateReader:async()=>({...preview,
      ...(state.candidateDrift?{collection_sha256:'f'.repeat(64)}:{})}),
    bindingReader:async()=>({scope,binding:{
      projectId:scope.project_id,assessmentId:scope.assessment_id,userId:'usr_fixture'
    }}),
    evidenceWriter:async ({projectId,userId,controlId,input:record})=>{
      reads.writer++;
      assert.equal(projectId,scope.project_id);
      assert.equal(userId,'usr_fixture');
      assert.equal(controlId,'ARL-KB-001');
      assert.equal(record.systemSnapshotId,SNAP);
      assert.equal(record.evidenceClass,'observed');
      assert.equal(record.sourceType,'arl_frozen_source_candidate');
      assert.equal(record.sourceReference,kb001EvidenceReference(candidate));
      assert.match(record.limitations,/Human recording rationale/);
      return {id:'cei_fixture',systemSnapshotId:SNAP,controlId,
        sourceType:record.sourceType,sourceReference:record.sourceReference,
        verificationState:'unverified'};
    }
  };
  return {pool,dependencies,reads,queried};
}

test('KB-001 record request requires explicit author, exact digests and confirmed human rationale',()=>{
  assert.equal(validateKb001EvidenceRecording(input).ticketId,TICKET);
  for(const mutation of [
    {confirmed:false},{projection_sha256:'bad'},
    {acknowledgement:'I accept PASS'},{rationale:'no'},
    {criterion_number:2},{control_id:'ARL-KB-002'}
  ])assert.throws(()=>validateKb001EvidenceRecording({...input,...mutation}),
    /Static evidence review/);
  assert.match(kb001EvidenceReference(candidate),/frozen-git:129a/);
  assert.match(kb001EvidenceLimitations(candidate,input.rationale),/not accepted proof/);
  assert.throws(()=>kb001EvidenceReference({...candidate,verified:true}),/unverified/);
});

test('verified immutable Master must match current canonical project, snapshot and Git SHA',async()=>{
  const document_md='# Frozen ARL master';
  const master={project_id:scope.project_id,assessment_id:scope.assessment_id,
    snapshot_project_id:scope.project_id,system_snapshot_id:SNAP,target_sha:SHA,
    snapshot_status:'current',document_md,
    document_sha256:crypto.createHash('sha256').update(document_md).digest('hex'),
    assessment_configuration_json:{assessmentBinding:{assessmentId:scope.assessment_id},
      targetBinding:{revision:SHA}}};
  const pool={query:async()=>({rows:[master]})};
  assert.equal((await readKb001VerifiedMaster(pool,scope)).integrity,'verified');
  await assert.rejects(readKb001VerifiedMaster({query:async()=>({
    rows:[{...master,snapshot_status:'historical'}]})},scope),/current exact snapshot/);
  await assert.rejects(readKb001VerifiedMaster({query:async()=>({
    rows:[{...master,document_sha256:'bad'}]})},scope),/SHA-256 mismatch/);
});

test('KB-001 creates one canonical unverified record with original context_required unchanged',async()=>{
  const {pool,dependencies,reads}=fakeDeps();
  const result=await recordKb001StaticEvidence(pool,input,'emprex',dependencies);
  assert.equal(result.saved,true);
  assert.equal(result.verification_state,'unverified');
  assert.equal(result.evidence_accepted,false);
  assert.equal(result.tests_executed,0);
  assert.equal(result.applicability_unchanged,true);
  assert.equal(result.evidence_id,'cei_fixture');
  assert.equal(reads.scope,2);
  assert.equal(reads.master,2);
  assert.equal(reads.writer,1);
  assert.equal(reads.locks,1);
  assert.equal(reads.unlocks,1);
});

test('duplicate evidence is not recorded twice; every refusal happens before a write',async()=>{
  const duplicate=fakeDeps({duplicate:true});
  const result=await recordKb001StaticEvidence(
    duplicate.pool,input,'emprex',duplicate.dependencies);
  assert.equal(result.already_recorded,true);
  assert.equal(result.saved,false);
  assert.equal(duplicate.reads.writer,0);
  for(const scenario of [
    {state:{wrongOwner:true},payload:input},
    {state:{notApplicable:true},payload:input},
    {state:{candidateDrift:true},payload:input},
    {state:{drift:true},payload:input},
    {state:{},payload:{...input,target_sha:'f'.repeat(40)}},
  ]){
    const env=fakeDeps(scenario.state);
    await assert.rejects(recordKb001StaticEvidence(
      env.pool,scenario.payload,'emprex',env.dependencies),/Static evidence review/);
    assert.equal(env.reads.writer,0);
  }
});
