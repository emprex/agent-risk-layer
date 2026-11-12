import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeBatchSourceReplay,replayTicketSourceEvidence}
  from '../desktop/enkyron-batch-source-replay.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const snap='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const collection='a'.repeat(64),projection='b'.repeat(64);
const master={available:true,integrity:'verified',snapshot_status:'current',
 project_id:'prj_pilot',assessment_id:'asm_pilot',snapshot_id:snap,target_sha:sha};
const preview={available:true,ticket_id:ticket,project_id:master.project_id,
 assessment_id:master.assessment_id,snapshot_id:snap,target_sha:sha,
 controls_total:108,collection_sha256:collection, evidence_persisted:0,
 tests_executed:0,evidence_accepted:false,
 kb001_candidate:{control_id:'ARL-KB-001',criterion_number:1,
   target_sha:sha,snapshot_id:snap,projection_sha256:projection,
   collection_sha256:collection},
 review_workplan:Array.from({length:108},(_,i)=>({
  control_id:'ARL-KB-'+String(i+1).padStart(3,'0'),
  title:'Fixture control '+String(i+1),category:'Fixture governance',
  stage:'applicability',source_requirements:1,
  human_document_requirements:2,authorised_runtime_requirements:1
 })),
 criteria:Array.from({length:108},(_,i)=>({
  control_id:'ARL-KB-'+String(i+1).padStart(3,'0'),criterion_number:1,
  state:'static_metadata_projected_unverified',projection_sha256:
    i===0?projection:String(i+1).padStart(64,'0')
 }))};
const record={evidence_id:'cei_a16a08432bdd4801b3c7aa753a9d21ea',
 control_id:'ARL-KB-001',snapshot_id:snap,target_sha:sha,
 record_integrity:'descriptor_digest_consistent',
 verification_state:'unverified',
 projection_sha256:projection,collection_sha256:collection};

test('108-control replay preparation is single-pass, read-only and KB-001 digests reproduce',()=>{
 const output=shapeBatchSourceReplay({ticketId:ticket,master,preview,record});
 assert.equal(output.available,true);
 assert.equal(output.controls_total,108);
 assert.equal(output.controls_with_source_routes,108);
 assert.equal(output.controls_without_static_routes,0);
 assert.equal(output.human_document_requirements_total,216);
 assert.equal(output.authorised_runtime_requirements_total,108);
 assert.equal(output.per_control[14].title,'Fixture control 15');
 assert.equal(output.per_control[14].human_document_requirements,2);
 assert.equal(output.per_control[14].authorised_runtime_requirements,1);
 assert.equal(output.source_criteria_total,108);
 assert.equal(output.metadata_projected_unverified,108);
 assert.equal(output.kb001_replay_status,'recorded_source_fingerprints_reproduced');
 assert.equal(output.kb001_evidence_id,record.evidence_id);
 assert.equal(output.per_control.length,108);
 assert.equal(output.per_control[0].control_id,'ARL-KB-001');
 assert.equal(output.per_control.at(-1).control_id,'ARL-KB-108');
 assert.equal(output.per_control[13].recorded_source_evidence,'not_inspected');
 assert.equal(output.recorded_evidence_verified,0);
 assert.equal(output.evidence_written,0);
 assert.equal(output.active_tests_executed,0);
 assert.equal(output.applicability_decisions_recorded,0);
 assert.equal(output.source_authenticated,false);
 assert.equal(output.approved_purpose_verified,false);
 assert.equal(output.human_review_required,true);
 assert.doesNotMatch(JSON.stringify(output),/descriptor_json|source_reference|limitations|private_key/);
});

test('different stored source fingerprint remains a mismatch, never PASS',()=>{
 const output=shapeBatchSourceReplay({
  ticketId:ticket,preview,master,
  record:{...record,collection_sha256:'f'.repeat(64)}
 });
 assert.equal(output.kb001_replay_status,'recorded_source_fingerprints_changed');
 assert.equal(output.evidence_written,0);
 assert.equal(output.source_authenticated,false);
 const absent=shapeBatchSourceReplay({ticketId:ticket,preview,master});
 assert.equal(absent.kb001_replay_status,'not_recorded');
 assert.equal(absent.controls_total,108);
 const duplicated=shapeBatchSourceReplay({ticketId:ticket,preview,master,duplicate:true});
 assert.equal(duplicated.kb001_replay_status,'duplicate_record_requires_review');
});

test('fail closed on snapshot mismatch, malformed controls, or unverified record digest',()=>{
 const wrongs=[
   {master:{...master,snapshot_id:'sys_changed'}},
   {master:{...master,integrity:'failed'}},
   {master:{...master,snapshot_status:'superseded'}},
   {preview:{...preview,controls_total:107}},
   {preview:{...preview,evidence_persisted:1}},
   {preview:{...preview,criteria:[...preview.criteria,{...preview.criteria[0]}]}},
   {preview:{...preview,criteria:[{...preview.criteria[0],control_id:'ARL-KB-109'}]}},
   {preview:{...preview,review_workplan:preview.review_workplan.slice(1)}},
   {preview:{...preview,review_workplan:preview.review_workplan.map((x,i)=>
     i===15?{...x,source_requirements:0}:x)}},
   {record:{...record,record_integrity:'unverified'}},
   {record:{...record,target_sha:'f'.repeat(40)}},
 ];
 for(const change of wrongs){
  assert.throws(()=>shapeBatchSourceReplay({
   ticketId:ticket,preview,master,record,...change}),/Batch source replay/);
 }
});

test('one collection, immutable read-only Master view, exact KB-001 record lookup and no writes',async()=>{
 let collectionCalls=0,recordedCalls=0,releaseCalls=0;
 const queries=[];
 const client={query:async(sql,values)=>{
  queries.push({sql,values});
  if(sql.startsWith('SELECT id FROM control_evidence_items'))
   return {rows:[{id:record.evidence_id}]};
  return {rows:[]};
 },release(){releaseCalls++}};
 const pool={connect:async()=>client};
 const result=await replayTicketSourceEvidence(pool,ticket,{
   collect:async(_pool,id)=>{assert.equal(id,ticket);collectionCalls++;return preview;},
   masterReader:async(_client,id)=>{assert.equal(id,ticket);return master;},
   recordedReader:async(_client,request)=>{recordedCalls++;
     assert.deepEqual(request,{
       ticket_id:ticket,control_id:'ARL-KB-001',evidence_id:record.evidence_id
     });return record;}
 });
 assert.equal(result.kb001_replay_status,'recorded_source_fingerprints_reproduced');
 assert.equal(collectionCalls,1);
 assert.equal(recordedCalls,1);
 assert.equal(releaseCalls,1);
 assert.equal(queries[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.deepEqual(queries[1].values,[master.project_id,snap,'ARL-KB-001',
   'arl_frozen_source_candidate','active']);
 assert.equal(queries[2].sql,'COMMIT');
 assert.equal(queries.filter(q=>/INSERT|UPDATE|DELETE/.test(q.sql)).length,0);
});

test('Master drift after source recollection fails closed and rolls back read-only transaction',async()=>{
 const queries=[];
 const pool={connect:async()=>({
   query:async sql=>{queries.push(sql);return {rows:[]};},
   release:()=>{}
 })};
 await assert.rejects(replayTicketSourceEvidence(pool,ticket,{
   collect:async()=>preview,
   masterReader:async()=>({...master,target_sha:'f'.repeat(40)})
 }),/Master changed/);
 assert.equal(queries.at(-1),'ROLLBACK');
 assert.equal(queries.filter(sql=>/INSERT|UPDATE|DELETE/.test(sql)).length,0);
});
