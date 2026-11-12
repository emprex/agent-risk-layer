import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planStaticMetadataBatch,validateStaticMetadataBatchCommit,
  previewStaticMetadataBatch,recordStaticMetadataBatchChunk,
  staticMetadataBatchLimitations
} from '../desktop/enkyron-static-metadata-batch.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const snapshot='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const project='prj_fixture',assessment='asm_fixture';
const collection='a'.repeat(64);
const scope={project_id:project,assessment_id:assessment,snapshot_id:snapshot,
  target_sha:sha,target_reference:'/frozen/miniagent'};
const noSource=new Set([30,31,32,106]);
const criteria=[];
const work=[];
for(let i=1;i<=108;i++){
  const id='ARL-KB-'+String(i).padStart(3,'0');
  const count=noSource.has(i)?0:(i===1?1:(i<=29?3:1));
  work.push({control_id:id,source_requirements:count,
    human_document_requirements:2,authorised_runtime_requirements:1});
  for(let k=1;k<=count;k++)criteria.push({
    control_id:id,criterion_number:k,
    state:'static_metadata_projected_unverified',
    projection_sha256:(i*100+k).toString(16).padStart(64,'0'),
    expected_collectors:['target_identity','source_and_configuration'],
    projected_collectors:['target_identity','source_and_configuration']
  });
}
const preview={available:true,ticket_id:ticket,project_id:project,
  assessment_id:assessment,snapshot_id:snapshot,target_sha:sha,
  controls_total:108,collection_sha256:collection,criteria,
  review_workplan:work,evidence_persisted:0,evidence_accepted:false,
  tests_executed:0};
const plan=planStaticMetadataBatch(preview);
const authorization={ticket_id:ticket,snapshot_id:snapshot,target_sha:sha,
  collection_sha256:collection,manifest_digest:plan.manifest_digest,
  cursor:0,confirmed:true,
  acknowledgement:'I AUTHORISE UNVERIFIED STATIC METADATA RECORDING ONLY',
  rationale:'I examined the frozen static manifest and authorise recording metadata as unverified candidates only; no source or approval is authenticated.'};

function fakeEnvironment({previous=[],badOwner=false,scopeDrift=false,failAfter=null,singleConnection=false}={}){
  const records=[...previous],queries=[],calls={writer:0,collect:0,scope:0,master:0};
  let leased=false;
  const client={
    async query(sql,args){
      queries.push(sql);
      if(sql.startsWith('SELECT id,entry_id,source_reference,verification_state,retention_status FROM control_evidence_items'))
        return {rows:records};
      if(sql.startsWith('SELECT id,verification_state,retention_status FROM control_evidence_items'))
        return {rows:records.filter(x=>x.id===args[0]&&
            x.entry_id===args[3]&&x.source_reference===args[5])
          .map(x=>({id:x.id,verification_state:x.verification_state,
            retention_status:x.retention_status}))};
      return {rows:[]};
    },release(){leased=false;}
  };
  const pool={
    async connect(){
      if(singleConnection&&leased)throw Error('single-connection pool already leased');
      leased=true;
      return client;
    },
    async query(sql){
      if(singleConnection&&leased)
        throw Error('pool.query would deadlock while sole client is leased');
      if(!sql.includes('FROM arl_workbench_tickets'))throw Error('unexpected pool query');
      return {rows:[{assigned_to:badOwner?'other':'emprex',
        assessor_name:'emprex',status:'scoping',archived_at:null}]};
    }
  };
  const deps={
    collect:async()=>{calls.collect++;return preview;},
    scopeReader:async(db)=>{
      if(singleConnection&&leased&&db!==client)
        throw Error('scope recheck must use leased client');
      calls.scope++;
      return {...scope,...(scopeDrift?{target_sha:'f'.repeat(40)}:{})};},
    masterReader:async(db)=>{
      if(singleConnection&&leased&&db!==client)
        throw Error('Master recheck must use leased client');
      calls.master++;
      return {integrity:'verified'};
    },
    bindingReader:async()=>({scope,binding:{
      projectId:project,assessmentId:assessment,userId:'usr_fixture'}}),
    writer:async ({projectId,controlId,userId,input})=>{
      calls.writer++;
      assert.equal(projectId,project);
      assert.equal(userId,'usr_fixture');
      assert.equal(input.systemSnapshotId,snapshot);
      assert.equal(input.evidenceClass,'observed');
      assert.equal(input.sourceType,'arl_static_projection_bundle');
      assert.match(input.sourceReference,/^frozen-git:/);
      assert.match(input.limitations,/NOT ACCEPTED PROOF/);
      if(failAfter!==null&&calls.writer>failAfter)throw Error('simulated writer interruption');
      const id='cei_'+calls.writer.toString(16).padStart(32,'0');
      records.push({id,entry_id:controlId,source_reference:input.sourceReference,
        verification_state:'unverified',retention_status:'active'});
      return {id,systemSnapshotId:snapshot,controlId,
        sourceType:input.sourceType,sourceReference:input.sourceReference,
        verificationState:'unverified'};
    }
  };
  return {pool,records,calls,queries,deps};
}

test('One reviewed source manifest covers 103 other KBs and skips 4 non-static and existing KB-001',()=>{
  assert.equal(plan.source_controls,104);
  assert.equal(plan.no_source_controls,4);
  assert.equal(plan.bundles.length,103);
  assert.equal(plan.bundles[0].control_id,'ARL-KB-002');
  assert.equal(plan.bundles.at(-1).control_id,'ARL-KB-108');
  assert.equal(plan.bundles.some(x=>x.control_id==='ARL-KB-001'),false);
  for(const id of ['ARL-KB-030','ARL-KB-031','ARL-KB-032','ARL-KB-106'])
    assert.equal(plan.bundles.some(x=>x.control_id===id),false);
  assert.equal(plan.total_requirements,criteria.length);
  assert.match(plan.manifest_digest,/^[a-f0-9]{64}$/);
  assert.equal(plan.bundles[0].requirements,3);
  assert.match(staticMetadataBatchLimitations(plan.bundles[0],plan,authorization.rationale),
    /UNVERIFIED DETERMINISTIC SOURCE METADATA CANDIDATE/);
});

test('All 108 controls and complete collector projections are required, no invented evidence',()=>{
  const bad=[
    {criteria:criteria.slice(1)},
    {criteria:[...criteria,{...criteria[0]}]},
    {criteria:criteria.map((x,i)=>i===0?{...x,state:'static_metadata_incomplete'}:x)},
    {criteria:criteria.map((x,i)=>i===0?{...x,projected_collectors:[]} :x)},
    {review_workplan:work.slice(1)},
    {review_workplan:work.map((x,i)=>i===2?{...x,source_requirements:0}:x)},
    {target_sha:'bad'}, {evidence_persisted:1}
  ];
  for(const changed of bad)assert.throws(()=>planStaticMetadataBatch({...preview,...changed}),
    /Batch metadata evidence/);
  for(const change of [{confirmed:false},{acknowledgement:'VERIFY ALL'},
    {rationale:'ok'},{cursor:-1},{snapshot_id:'changed'},
    {manifest_digest:'not digest'}])
    assert.throws(()=>validateStaticMetadataBatchCommit({...authorization,...change}),
      /Batch metadata evidence/);
});

test('Read-only preview reports precise 103 candidates and no DB writes',async()=>{
  const env=fakeEnvironment();
  const result=await previewStaticMetadataBatch(env.pool,ticket,env.deps);
  assert.equal(result.to_record,103);
  assert.equal(result.candidate_control_bundles,103);
  assert.equal(result.machine_source_controls,104);
  assert.equal(result.controls_without_source,4);
  assert.equal(result.excluded_existing_kb001,1);
  assert.equal(result.verification_state,'unverified');
  assert.equal(result.manifest_digest,plan.manifest_digest);
  assert.equal(env.calls.writer,0);
  assert.match(env.queries[0],/READ ONLY/);
  assert.equal(env.queries.at(-1),'COMMIT');
});

test('Batch rechecks use leased client with a single-connection PostgreSQL pool',async()=>{
  const env=fakeEnvironment({singleConnection:true});
  const result=await recordStaticMetadataBatchChunk(
    env.pool,authorization,'emprex',env.deps);
  assert.equal(result.created,16);
  assert.equal(env.records.length,16);
  assert.ok(env.calls.scope>=17);
  assert.ok(env.calls.master>=17);
});

test('One explicit confirmation processes 103 other KBs in resumable 16-record chunks with idempotency',async()=>{
  const env=fakeEnvironment();
  let cursor=0,created=0,chunks=0;
  do{
    const result=await recordStaticMetadataBatchChunk(
      env.pool,{...authorization,cursor},'emprex',env.deps);
    assert.equal(result.verification_state,'unverified');
    assert.equal(result.evidence_accepted,false);
    assert.equal(result.active_tests_executed,0);
    assert.equal(result.decisions_recorded,0);
    assert.equal(result.master_modified,false);
    assert.ok(result.next_cursor>cursor);
    assert.ok(result.created<=16);
    cursor=result.next_cursor;
    chunks++;
    created+=result.created;
  }while(cursor<plan.bundles.length);
  assert.equal(cursor,103);
  assert.equal(created,103);
  assert.equal(env.records.length,103);
  assert.equal(chunks,7);
  // Retry of the first chunk is a no-op, not a second batch.
  const replay=await recordStaticMetadataBatchChunk(
    env.pool,{...authorization,cursor:0},'emprex',env.deps);
  assert.equal(replay.created,0);
  assert.equal(replay.skipped,16);
  assert.equal(env.records.length,103);
  assert.equal(env.calls.writer,103);
  assert.equal(env.queries.filter(q=>q.includes('pg_advisory_lock')).length,
    env.queries.filter(q=>q.includes('pg_advisory_unlock')).length);
});

test('Writer failure leaves independently committed rows resumable without duplication',async()=>{
  const env=fakeEnvironment({failAfter:5});
  await assert.rejects(recordStaticMetadataBatchChunk(
    env.pool,authorization,'emprex',env.deps),/simulated writer interruption/);
  assert.equal(env.records.length,5);
  env.deps.writer=async ({controlId,input})=>{
    const id='cei_'+(env.records.length+1).toString(16).padStart(32,'0');
    env.records.push({id,entry_id:controlId,source_reference:input.sourceReference,
      verification_state:'unverified',retention_status:'active'});
    return {id,systemSnapshotId:snapshot,controlId,
      sourceType:input.sourceType,sourceReference:input.sourceReference,
      verificationState:'unverified'};
  };
  const retry=await recordStaticMetadataBatchChunk(
    env.pool,authorization,'emprex',env.deps);
  assert.equal(retry.created,11);
  assert.equal(retry.skipped,5);
  assert.equal(env.records.length,16);
});

test('Wrong owner, stale manifest, changed SHA, and conflicting prior record refuse before writes',async()=>{
  const scenarios=[
    {env:{badOwner:true},request:authorization},
    {env:{scopeDrift:true},request:authorization},
    {env:{},request:{...authorization,manifest_digest:'f'.repeat(64)}},
    {env:{previous:[{id:'cei_'+'1'.repeat(32),entry_id:'ARL-KB-002',
      source_reference:'frozen-git:old',verification_state:'unverified',
      retention_status:'active'}]},request:authorization},
    {env:{previous:[{id:'cei_'+'1'.repeat(32),entry_id:'ARL-KB-002',
      source_reference:plan.bundles[0].source_reference,verification_state:'verified',
      retention_status:'active'}]},request:authorization}
  ];
  for(const {env:options,request} of scenarios){
    const env=fakeEnvironment(options);
    await assert.rejects(recordStaticMetadataBatchChunk(
      env.pool,request,'emprex',env.deps),/Batch metadata evidence/);
    assert.equal(env.calls.writer,0);
  }
});
