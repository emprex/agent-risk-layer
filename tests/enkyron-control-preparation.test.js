import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  shapeControlPreparation,prepareTicketControlDossiers,readPreparedTicketControlQueue
} from '../desktop/enkyron-control-preparation.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const scope={project_id:'prj_5b5257843a6d4aed9dac280d19a3502f',
  snapshot_id:'sys_a1ea05c78ee64357a4c8a75b47ce4662',
  target_sha:'129a20f42321742229ba78c3f1b13ea925ea7622'};
const id=i=>'ARL-KB-'+String(i).padStart(3,'0');
const items=Array.from({length:108},(_,i)=>({
  control_id:id(i+1),title:'Control '+id(i+1),
  stage:'applicability',next_action:'Review declared scope'
}));
const rows=Array.from({length:108},(_,i)=>({
  control_id:id(i+1),title:'Canonical control '+id(i+1),
  category:'Governance and scope',
  knowledge_digest:'kb'+(i+1),check_digest:'check'+(i+1),
  objective:'Check exact system security control in version-bound assessment',
  method:'Review source and human documents',
  required_evidence_json:JSON.stringify([
    'dependency and version inventory',
    'accountable human decision record for control acceptance',
    'observed runtime test result from the frozen agent'
  ])
}));
const queue={total:108,project_id:scope.project_id,
  snapshot_id:scope.snapshot_id,target_sha:scope.target_sha,items,stages:{applicability:108}};

test('ARL prepares 108 separate evidence checklists without any inferred verdict',()=>{
  const p=shapeControlPreparation({scope,rows,items});
  assert.equal(p.controls_total,108);
  assert.equal(p.dossiers.length,108);
  assert.deepEqual(p.criterion_routes,{
    source_candidates:108,owner_documents:108,authorised_runtime:108
  });
  assert.equal(p.dossiers[0].control_id,'ARL-KB-001');
  assert.equal(p.dossiers.at(-1).control_id,'ARL-KB-108');
  assert.equal(p.dossiers[0].required_evidence[0].route,'machine_collectable');
  assert.equal(p.dossiers[0].required_evidence[1].route,'human_only');
  assert.equal(p.dossiers[0].required_evidence[2].route,'active_test_or_runtime');
  assert.equal(p.dossiers[0].prepared_decision,null);
  assert.equal(p.security_state_changed,false);
  assert.equal(p.decisions_recorded,0);
  assert.equal(p.tests_executed,0);
  assert.equal(p.dossiers[0].required_evidence[0].source_verified,false);
});

test('preparation fails closed for partial, duplicate, mismatched or malformed knowledge',()=>{
  for(const broken of [
    rows.slice(0,-1),
    [...rows.slice(0,-1),rows[0]],
    rows.map((r,i)=>i===0?{...r,control_id:'ARL-KB-999'}:r),
    rows.map((r,i)=>i===1?{...r,required_evidence_json:'{'}:r),
    rows.map((r,i)=>i===1?{...r,required_evidence_json:[true]}:r),
  ]){
    assert.throws(()=>shapeControlPreparation({scope,rows:broken,items}),
      /Control preparation/);
  }
  assert.throws(()=>shapeControlPreparation({scope:{...scope,target_sha:'bad'},rows,items}),
    /Control preparation/);
});

test('read-only preparation binds workflow and check definitions to exact project and snapshot',async()=>{
  let reads=0;
  const queries=[];
  const pool={query:async(sql,params)=>{
    queries.push({sql,params});
    return {rows};
  }};
  const scopeReader=async()=>{reads++;return scope;};
  const prepared=await prepareTicketControlDossiers(pool,ticket,{
    scopeReader,queueReader:async()=>queue
  });
  assert.equal(prepared.ticket_id,ticket);
  assert.equal(prepared.dossiers.length,108);
  assert.equal(reads,2);
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/SELECT/);
  assert.deepEqual(queries[0].params,[scope.project_id,scope.snapshot_id]);
  assert.ok(!/INSERT|UPDATE|DELETE/i.test(queries[0].sql));
  const combined=await readPreparedTicketControlQueue(pool,ticket,{
    scopeReader,queueReader:async()=>queue
  });
  assert.equal(combined.preparation.dossiers.length,108);
  assert.equal(combined.items.length,108);
});

test('queue/snapshot drift blocks preparation without persisting draft decisions',async()=>{
  const pool={query:async()=>({rows})};
  await assert.rejects(prepareTicketControlDossiers(pool,ticket,{
    scopeReader:async()=>scope,
    queueReader:async()=>({...queue,target_sha:'f'.repeat(40)})
  }),/snapshot/);
  let index=0;
  await assert.rejects(prepareTicketControlDossiers(pool,ticket,{
    scopeReader:async()=>({...scope,snapshot_id:++index===1?scope.snapshot_id:'sys_changed'}),
    queueReader:async()=>queue
  }),/changed during preparation/);
});
