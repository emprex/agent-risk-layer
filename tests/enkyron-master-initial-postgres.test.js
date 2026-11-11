// Real PostgreSQL regression for the exact Master INSERT and GENERATED ALWAYS identity.
// This uses TEMP tables and a synthetic Git repository; no production rows are written.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {previewInitialMaster,recordInitialMaster} from '../desktop/enkyron-master-initial.mjs';

test('Master revision 1 uses database-generated identity on real PostgreSQL', {
  skip:!process.env.ARL_CI_POSTGRES_URL
},async()=>{
  const pool=new pg.Pool({
    connectionString:process.env.ARL_CI_POSTGRES_URL,
    max:1,connectionTimeoutMillis:5000
  });
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-master-postgres-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe',encoding:'utf8'}).trim();
  try {
    git('init','-q');
    git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic tester');
    fs.writeFileSync(path.join(dir,'README.md'),'Synthetic Master test.\n');
    git('add','README.md');
    git('commit','-qm','synthetic');
    const sha=git('rev-parse','HEAD');
    const ticketId='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
    const project='prj_synthetic_master_pg';
    const assessment='asm_synthetic_master_pg';
    const snapshot='sys_synthetic_master_pg';
    const ticket={
      id:ticketId,ticket_number:'ARL-2026-000002',
      title:'Synthetic master validation',client_name:'Synthetic laboratory',
      status:'scoping',archived_at:null,assigned_to:os.userInfo().username,
      assessor_name:os.userInfo().username,target_kind:'git',
      target_reference:dir,linked_project_id:project,linked_assessment_id:assessment,
      scope_text:'Authorised read-only test',system_owner:'Synthetic test lab',
      permission_reference:'Not yet verified'
    };
    const scope={available:true,project_id:project,assessment_id:assessment,
      snapshot_id:snapshot,target_sha:sha,target_reference:dir};
    const items=Array.from({length:108},(_,i)=>({
      control_id:'ARL-KB-'+String(i+1).padStart(3,'0'),
      title:'Synthetic control '+(i+1),stage:'applicability',
      chain_status:'needs_review',next_action:'Review'
    }));
    const queue={total:108,project_id:project,assessment_id:assessment,
      snapshot_id:snapshot,target_sha:sha,items,
      preparation:{available:true,controls_total:108,
        snapshot_id:snapshot,target_sha:sha,
        dossiers:items.map(x=>({
          control_id:x.control_id,stage:x.stage,
          knowledge_digest:'synthetic-knowledge',
          check_digest:'synthetic-check',required_evidence:[]
        }))
      }
    };
    // PostgreSQL TEMP tables shadow the production table names on this connection.
    await pool.query(
      'CREATE TEMP TABLE arl_workbench_tickets ('+
        'id TEXT PRIMARY KEY,ticket_number TEXT,title TEXT,client_name TEXT,'+
        'status TEXT,archived_at TIMESTAMPTZ,assigned_to TEXT,assessor_name TEXT,'+
        'target_kind TEXT,target_reference TEXT,linked_project_id TEXT,'+
        'linked_assessment_id TEXT,scope_text TEXT,system_owner TEXT,'+
        'permission_reference TEXT);'+
      'CREATE TEMP TABLE system_snapshots ('+
        'id TEXT PRIMARY KEY,project_id TEXT,status TEXT,'+
        'assessment_configuration_json JSONB);'+
      'CREATE TEMP TABLE assessment_master_dossier_revisions ('+
        'id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,'+
        'project_id TEXT NOT NULL,system_snapshot_id TEXT NOT NULL,'+
        'assessment_id TEXT NOT NULL,dossier_key TEXT NOT NULL,'+
        'revision INTEGER NOT NULL,target_sha TEXT NOT NULL,'+
        'document_md TEXT NOT NULL,document_sha256 TEXT NOT NULL,'+
        'control_states JSONB NOT NULL,record_type TEXT NOT NULL,'+
        'recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
        'UNIQUE(project_id,system_snapshot_id,dossier_key,revision));'
    );
    await pool.query(
      'INSERT INTO arl_workbench_tickets '+
      '(id,ticket_number,title,client_name,status,archived_at,assigned_to,'+
      'assessor_name,target_kind,target_reference,linked_project_id,linked_assessment_id,'+
      'scope_text,system_owner,permission_reference) '+
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [ticket.id,ticket.ticket_number,ticket.title,ticket.client_name,
       ticket.status,ticket.archived_at,ticket.assigned_to,ticket.assessor_name,
       ticket.target_kind,ticket.target_reference,ticket.linked_project_id,
       ticket.linked_assessment_id,ticket.scope_text,ticket.system_owner,
       ticket.permission_reference]
    );
    await pool.query(
      'INSERT INTO system_snapshots '+
      '(id,project_id,status,assessment_configuration_json) VALUES ($1,$2,$3,$4::jsonb)',
      [snapshot,project,'current',JSON.stringify({
        assessmentBinding:{assessmentId:assessment},
        targetBinding:{source:'git',revision:sha}
      })]
    );
    const deps={scopeReader:async()=>scope,queueReader:async()=>queue};
    const candidate=await previewInitialMaster(pool,ticketId,ticket.assigned_to,deps);
    const result=await recordInitialMaster(pool,{
      ticket_id:ticketId,snapshot_id:snapshot,target_sha:sha,
      preview_digest:candidate.preview_digest,confirmed:true
    },ticket.assigned_to,deps);
    assert.equal(result.saved,true);
    assert.equal(result.revision,1);
    const saved=await pool.query(
      'SELECT id,revision,document_sha256,control_states FROM assessment_master_dossier_revisions'
    );
    assert.equal(saved.rowCount,1);
    assert.equal(saved.rows[0].id,'1');
    assert.equal(saved.rows[0].revision,1);
    assert.equal(saved.rows[0].document_sha256,candidate.document_sha256);
    assert.equal(saved.rows[0].control_states.controls.length,108);
    const repeated=await previewInitialMaster(pool,ticketId,ticket.assigned_to,deps);
    assert.equal(repeated.available,false);
    await assert.rejects(recordInitialMaster(pool,{
      ticket_id:ticketId,snapshot_id:snapshot,target_sha:sha,
      preview_digest:candidate.preview_digest,confirmed:true
    },ticket.assigned_to,deps),/already exists/);
    const check=await pool.query('SELECT count(*)::integer AS n FROM assessment_master_dossier_revisions');
    assert.equal(check.rows[0].n,1);
  } finally {
    await pool.end();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
