import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  buildInitialMaster,previewInitialMaster,recordInitialMaster
} from '../desktop/enkyron-master-initial.mjs';

const ticketId='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const project='prj_synthetic_master';
const assessment='asm_synthetic_master';
const snapshot='sys_synthetic_master';
const control=i=>'ARL-KB-'+String(i).padStart(3,'0');
const ticket={
  id:ticketId,ticket_number:'ARL-2026-000002',title:'Synthetic pilot',
  client_name:'Internal Lab',status:'scoping',archived_at:null,
  assigned_to:'emprex',assessor_name:'emprex',
  linked_project_id:project,linked_assessment_id:assessment,
  target_kind:'git',target_reference:'/home/emprex/synthetic-target',
  scope_text:'Read-only engineering pilot',system_owner:'Internal lab',
  permission_reference:''
};
const scope={available:true,project_id:project,assessment_id:assessment,
  snapshot_id:snapshot,target_sha:sha,target_reference:ticket.target_reference};
const items=Array.from({length:108},(_,i)=>({
  control_id:control(i+1),title:'Control '+(i+1),stage:'applicability',
  chain_status:'needs_review',next_action:'Human review'
}));
const dossiers=items.map(x=>({
  control_id:x.control_id,stage:x.stage,
  knowledge_digest:'knowledge-sha',check_digest:'check-sha',
  required_evidence:[{requirement:'owner documents'},{requirement:'source observation'}]
}));
const queue={total:108,items,project_id:project,assessment_id:assessment,
  snapshot_id:snapshot,target_sha:sha,
  preparation:{available:true,controls_total:108,project_id:project,
    snapshot_id:snapshot,target_sha:sha,dossiers}};

test('initial Master renders only existing snapshot and 108 controls, without verdicts',()=>{
  const built=buildInitialMaster({ticket,scope,queue,actor:'emprex'});
  assert.equal(built.dossier_key,ticket.ticket_number);
  assert.equal(built.control_states.controls_total,108);
  assert.equal(built.control_states.controls.length,108);
  assert.equal(built.control_states.controls[0].control_id,'ARL-KB-001');
  assert.equal(built.control_states.controls.at(-1).control_id,'ARL-KB-108');
  assert.equal(built.control_states.controls[0].workflow_stage,'applicability');
  assert.match(built.document_md,/NOT an approved security verdict/);
  assert.match(built.document_md,/No test executed by this Master initialization/);
  assert.match(built.document_md,/Permission reference \(unverified\): Not recorded/);
  assert.match(built.document_md,/KB-108/);
  assert.equal(built.document_sha256,
    crypto.createHash('sha256').update(built.document_md).digest('hex'));
  assert.deepEqual(built,buildInitialMaster({ticket,scope,queue,actor:'emprex'}));
});

test('initial Master refuses partial controls, duplicates, wrong snapshot and non-owner',()=>{
  assert.throws(()=>buildInitialMaster({ticket,scope,queue:{
    ...queue,items:items.slice(1)
  },actor:'emprex'}),/108 canonical/);
  assert.throws(()=>buildInitialMaster({ticket,scope,queue:{
    ...queue,items:[items[0],...items.slice(0,107)]
  },actor:'emprex'}),/canonical control index/);
  assert.throws(()=>buildInitialMaster({ticket,scope,queue:{
    ...queue,target_sha:'f'.repeat(40)
  },actor:'emprex'}),/108 canonical/);
  assert.throws(()=>buildInitialMaster({ticket,scope,queue,
    actor:'other'}),/accountable assigned operator/);
});

test('read-only preview refuses existing Master and performs zero writes',async()=>{
  const reads=[];
  const pool={query:async(sql)=>{
    reads.push(sql);
    if(sql.includes('FROM arl_workbench_tickets'))return{rows:[ticket]};
    if(sql.includes('FROM assessment_master_dossier_revisions'))return{rows:[]};
    throw Error('Unexpected query');
  }};
  const deps={scopeReader:async()=>scope,queueReader:async()=>queue};
  const draft=await previewInitialMaster(pool,ticketId,'emprex',deps);
  assert.equal(draft.available,true);
  assert.equal(draft.controls_total,108);
  assert.ok(reads.every(s=>/^SELECT/.test(s)));
  const occupied={query:async(sql)=>{
    if(sql.includes('FROM arl_workbench_tickets'))return{rows:[ticket]};
    return{rows:[{id:2}]};
  }};
  const exists=await previewInitialMaster(occupied,ticketId,'emprex',deps);
  assert.equal(exists.available,false);
  assert.match(exists.reason,/already exists/);
});

test('record rejects absent approval or changed preview before starting a transaction',async()=>{
  const pool={query:async(sql)=>{
    if(sql.includes('FROM arl_workbench_tickets'))return{rows:[ticket]};
    return{rows:[]};
  },connect:async()=>{throw Error('must not start transaction');}};
  const deps={scopeReader:async()=>scope,queueReader:async()=>queue};
  await assert.rejects(recordInitialMaster(pool,{ticket_id:ticketId},'emprex',deps),
    /explicit human confirmation/);
  await assert.rejects(recordInitialMaster(pool,{
    ticket_id:ticketId,confirmed:true,preview_digest:'f'.repeat(64),
    snapshot_id:snapshot,target_sha:sha
  },'emprex',deps),/preview is stale/);
});

test('approved first revision uses a single locked transaction and existing bigint ID',async()=>{
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-master-test-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'});
  try{
    git('init','-q');git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic tester');
    fs.writeFileSync(path.join(dir,'README'),'Synthetic only\n');
    git('add','README');git('commit','-qm','initial');
    const frozen=git('rev-parse','HEAD').toString().trim();
    const t={...ticket,target_reference:dir};
    const s={...scope,target_reference:dir,target_sha:frozen};
    const q={...queue,target_sha:frozen,
      preparation:{...queue.preparation,target_sha:frozen}};
    const statements=[];
    const dbQuery=async(sql,values=[])=>{
      statements.push({sql,values});
      if(sql.startsWith('SELECT * FROM arl_workbench_tickets'))return {rows:[t]};
      if(sql.includes('SELECT id FROM assessment_master_dossier_revisions'))return {rows:[]};
      if(sql.includes('FROM system_snapshots'))return {rows:[{
        id:snapshot,project_id:project,status:'current',
        assessment_configuration_json:{
          targetBinding:{revision:frozen},assessmentBinding:{assessmentId:assessment}
        }
      }]};
      if(sql.includes('COALESCE(MAX(id)'))return {rows:[{next_id:'41'}]};
      if(sql.includes('INSERT INTO assessment_master_dossier_revisions'))
        return {rows:[{id:'41',recorded_at:'2026-11-11T22:00:00Z'}]};
      return {rows:[]};
    };
    const pool={query:dbQuery,connect:async()=>({
      query:dbQuery,release:()=>statements.push({sql:'RELEASE'})
    })};
    const deps={scopeReader:async()=>s,queueReader:async()=>q};
    const candidate=await previewInitialMaster(pool,ticketId,'emprex',deps);
    const result=await recordInitialMaster(pool,{
      ticket_id:ticketId,confirmed:true,
      preview_digest:candidate.preview_digest,
      snapshot_id:snapshot,target_sha:frozen
    },'emprex',deps);
    assert.equal(result.saved,true);
    assert.equal(result.revision,1);
    assert.equal(result.document_sha256,candidate.document_sha256);
    const insert=statements.find(q=>q.sql.startsWith('INSERT INTO assessment_master_dossier_revisions'));
    assert.ok(insert);
    assert.equal(insert.values[0],'41');
    assert.equal(insert.values[4],'ARL-2026-000002');
    assert.equal(insert.values[7],candidate.document_sha256);
    assert.equal(JSON.parse(insert.values[8]).controls.length,108);
    assert.ok(statements.some(q=>q.sql.startsWith('LOCK TABLE')));
    assert.ok(statements.some(q=>q.sql==='COMMIT'));
    assert.ok(!statements.some(q=>q.sql==='ROLLBACK'));
    // A real PostgreSQL failure must disclose a safe stage and SQLSTATE,
    // not the generic "Local PostgreSQL operation failed" or raw DB values.
    const failureQueries=[];
    const failurePool={query:dbQuery,connect:async()=>({
      query:async(sql,values=[])=>{
        failureQueries.push(sql);
        if(sql.startsWith('INSERT INTO assessment_master_dossier_revisions')){
          const error=new Error('SECRET DATABASE DETAILS MUST NOT BE SHOWN');
          error.code='23514';
          throw error;
        }
        return dbQuery(sql,values);
      },
      release:()=>{}
    })};
    await assert.rejects(recordInitialMaster(failurePool,{
      ticket_id:ticketId,confirmed:true,
      preview_digest:candidate.preview_digest,
      snapshot_id:snapshot,target_sha:frozen
    },'emprex',deps),error=>{
      assert.match(error.message,
        /Master initialization: Master revision INSERT failed: check constraint conflict \[SQLSTATE 23514\]/);
      assert.doesNotMatch(error.message,/SECRET DATABASE DETAILS/);
      return true;
    });
    assert.ok(failureQueries.includes('ROLLBACK'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
