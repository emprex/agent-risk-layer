import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordPilotLabHandoff,validatePilotLabHandoff,verifyLabCase,LAB_ACK
} from '../desktop/enkyron-pilot-lab-handoff.mjs';

const ticket='11111111-1111-4111-8111-111111111111';
const snapshot='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const run='run-20261112T123811Z';
const kb='ARL-KB-053';
const request={ticket_id:ticket,case_id:'LAB-03',control_id:kb,
  run_id:run,snapshot_id:snapshot,target_sha:sha,
  confirmed:true,acknowledgement:LAB_ACK};
const lab={available:true,ticket_id:ticket,snapshot_id:snapshot,target_sha:sha,
  run_id:run,manifest_verified:true,synthetic_only:true,master_modified:false,
  tests:[{id:'LAB-03',controls:['ARL-KB-053','ARL-KB-065'],
    campaign:'TP-09',state:'FAIL_LAB_EXPECTATION',
    provider:'ScriptedProvider (not a real LLM)',
    observed:{synthetic_effect_count:1,approval_present:false}}]};

function fixture({owner='emprex',stage='test',failEvidence=false}={}){
  let recordedTests=[],recordedEvidence=[],calls=[],leased=false,writeTests=0,writeEvidence=0;
  const client={
    async query(sql,params=[]){
      calls.push(sql);
      if(sql.includes('pg_advisory_lock')||sql.includes('pg_advisory_unlock'))
        return {rows:[]};
      if(sql.includes('FROM arl_workbench_tickets'))
        return {rows:[{assigned_to:owner,assessor_name:owner,status:'scoping',archived_at:null}]};
      if(sql.includes('FROM control_test_executions'))
        return {rows:recordedTests.filter(t=>t.input_reference===params[3])};
      if(sql.includes('FROM control_evidence_items'))
        return {rows:recordedEvidence.filter(e=>e.source_reference===params[4])};
      throw Error('Unexpected SQL '+sql);
    },
    release(){leased=false;}
  };
  const pool={
    async connect(){
      if(leased)throw Error('single-connection pool already leased');
      leased=true;return client;
    },
    async query(){throw Error('pool.query while client is locked (deadlock)');}
  };
  const deps={
    labReader:async()=>lab,
    masterReader:async()=>({
      available:true,integrity:'verified',revision:1,
      snapshot_id:snapshot,target_sha:sha,
      project_id:'p1',assessment_id:'a1'}),
    scopeReader:async(db)=>{
      assert.equal(db,client);return {project_id:'p1',assessment_id:'a1',snapshot_id:snapshot,target_sha:sha};},
    bindingReader:async(db)=>{
      assert.equal(db,client);return {binding:{projectId:'p1',assessmentId:'a1',userId:'u1'}};},
    detailReader:async(db)=>{
      assert.equal(db,client);return {control_id:kb,snapshot_id:snapshot,
        stage,applicability_status:'applicable'};},
    testWriter:async(args)=>{
      writeTests++;
      assert.equal(args.controlId,kb);
      assert.equal(args.input.result,'inconclusive');
      assert.equal(args.input.executionKind,'initial');
      assert.match(args.input.limitations,/SYNTHETIC/);
      recordedTests.push({
        id:'ctx_'+'a'.repeat(32),entry_id:kb,system_snapshot_id:snapshot,
        result:'inconclusive',execution_kind:'initial',
        execution_method:args.input.executionMethod,
        input_reference:args.input.inputReference
      });
      return {id:'ctx_'+'a'.repeat(32),result:'inconclusive',systemSnapshotId:snapshot};
    },
    evidenceWriter:async(args)=>{
      writeEvidence++;
      if(failEvidence&&writeEvidence===1)throw Error('simulated writer failure');
      assert.equal(args.controlId,kb);
      assert.equal(args.input.evidenceClass,'test_generated');
      assert.equal(args.input.sourceType,'arl_synthetic_lab_case');
      assert.equal(args.input.testExecutionId,'ctx_'+'a'.repeat(32));
      recordedEvidence.push({
        id:'cei_'+'b'.repeat(32),entry_id:kb,system_snapshot_id:snapshot,
        verification_state:'unverified',retention_status:'active',
        test_execution_id:args.input.testExecutionId,
        source_reference:args.input.sourceReference
      });
      return {id:'cei_'+'b'.repeat(32),testExecutionId:args.input.testExecutionId,
        verificationState:'unverified',sourceReference:args.input.sourceReference,
        systemSnapshotId:snapshot};
    }
  };
  return {pool,deps,calls,counts:()=>({tests:writeTests,evidence:writeEvidence,
    persistedTests:recordedTests.length,persistedEvidence:recordedEvidence.length})};
}

test('reviewed local lab is bound to case, KB, target SHA and run',()=>{
  assert.equal(validatePilotLabHandoff(request),request);
  assert.match(verifyLabCase(request,lab).sourceRef,/^lab-synthetic:run-/);
  assert.throws(()=>validatePilotLabHandoff({...request,confirmed:false}),/confirmation/);
  assert.throws(()=>verifyLabCase({...request,control_id:'ARL-KB-065'},{
    ...lab,target_sha:'0'.repeat(40)}),/does not match/);
  assert.throws(()=>verifyLabCase({...request,case_id:'LAB-10'},lab),/case/);
  assert.throws(()=>verifyLabCase(request,{...lab,tests:[{...lab.tests[0],
    provider:'OllamaProvider'}]}),/provider/);
});

test('one owner-confirmed case stores inconclusive test and unverified evidence once',async()=>{
  const f=fixture();
  const first=await recordPilotLabHandoff(f.pool,request,'emprex',f.deps);
  assert.equal(first.saved,true);
  assert.equal(first.already_recorded,false);
  assert.equal(first.test_result,'inconclusive');
  assert.equal(first.verification_state,'unverified');
  assert.equal(first.master_modified,false);
  assert.deepEqual(f.counts(),{tests:1,evidence:1,persistedTests:1,persistedEvidence:1});
  const second=await recordPilotLabHandoff(f.pool,request,'emprex',f.deps);
  assert.equal(second.already_recorded,true);
  assert.deepEqual(f.counts(),{tests:1,evidence:1,persistedTests:1,persistedEvidence:1});
});

test('interrupted evidence writer resumes exact test without duplicating it',async()=>{
  const f=fixture({failEvidence:true});
  await assert.rejects(()=>recordPilotLabHandoff(f.pool,request,'emprex',f.deps),
    /simulated writer failure/);
  assert.equal(f.counts().persistedTests,1);
  assert.equal(f.counts().persistedEvidence,0);
  const done=await recordPilotLabHandoff(f.pool,request,'emprex',f.deps);
  assert.equal(done.test_result,'inconclusive');
  assert.deepEqual(f.counts(),{tests:1,evidence:2,persistedTests:1,persistedEvidence:1});
});

test('wrong owner and non-test stage refuse before any canonical write',async()=>{
  const wrong=fixture({owner:'another'});
  await assert.rejects(()=>recordPilotLabHandoff(wrong.pool,request,'emprex',wrong.deps),
    /accountable human operator/);
  assert.equal(wrong.counts().tests,0);
  const stage=fixture({stage:'applicability'});
  await assert.rejects(()=>recordPilotLabHandoff(stage.pool,request,'emprex',stage.deps),
    /not awaiting a test/);
  assert.equal(stage.counts().tests,0);
});

test('missing Master or wrong target fails closed and preserves canonical state',async()=>{
  const m=fixture();
  m.deps.masterReader=async()=>({available:true,integrity:'unverified'});
  await assert.rejects(()=>recordPilotLabHandoff(m.pool,request,'emprex',m.deps),
    /Master R1/);
  assert.equal(m.counts().tests,0);
  const changed=fixture();
  changed.deps.scopeReader=async()=>({project_id:'p1',assessment_id:'a1',
    snapshot_id:snapshot,target_sha:'0'.repeat(40)});
  await assert.rejects(()=>recordPilotLabHandoff(changed.pool,request,'emprex',changed.deps),
    /target changed/);
  assert.equal(changed.counts().tests,0);
});
