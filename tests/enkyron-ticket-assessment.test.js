import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  validateAssessmentSelection,frozenLocalTarget,linkOrCreateTicketAssessment,
  readLinkedAssessmentContext
} from '../desktop/enkyron-ticket-assessment.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';

test('assessment onboarding requires explicit ticket, folder and exact SHA',()=>{
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'relative'},false),
    /Local assessment requires/);
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',expected_sha:sha},true),
    /explicit confirmation/);
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',
    expected_sha:'1234',confirmed:true},true),/exact Git commit SHA/);
  assert.deepEqual(
    validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',
      expected_sha:sha,confirmed:true},true),
    {ticketId:ticket,requestedPath:'/home/x',expectedSha:sha}
  );
});

test('assessment preflight never accepts a dirty or non-root Git target',()=>{
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-assessment-test-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'});
  try {
    git('init','-q');
    git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic Test');
    fs.writeFileSync(path.join(dir,'README.txt'),'test repository\n');
    git('add','README.txt');
    git('commit','-qm','test');
    const frozen=frozenLocalTarget(dir);
    assert.equal(frozen.clean,true);
    assert.match(frozen.sha,/^[0-9a-f]{40}$/);
    fs.mkdirSync(path.join(dir,'subdir'));
    assert.throws(()=>frozenLocalTarget(path.join(dir,'subdir')),
      /select the repository root/);
    fs.writeFileSync(path.join(dir,'unexpected.txt'),'dirty');
    assert.throws(()=>frozenLocalTarget(dir),
      /uncommitted or untracked/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('link cannot reach a database without matching human-confirmed frozen SHA',async()=>{
  const db={query:()=>{throw Error('unexpected db access');}};
  await assert.rejects(
    linkOrCreateTicketAssessment(db,{
      ticket_id:ticket,repository_path:'/not/a/repo',
      expected_sha:sha,confirmed:true,operation:'create_new'
    },'emprex'),
    /target folder is not available/
  );
});

test('existing canonical project is linked atomically using the original ticket audit schema',async()=>{
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-assessment-link-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'});
  try {
    git('init','-q');
    git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic Test');
    fs.writeFileSync(path.join(dir,'README.txt'),'reviewed fixture\\n');
    git('add','README.txt');
    git('commit','-qm','test');
    const revision=frozenLocalTarget(dir).sha;
    const queries=[];
    const project='prj_synthetic_2',assessment='asm_synthetic_2',snapshot='sys_synthetic_2';
    const candidate={
      id:project,name:'Synthetic pilot',agent_assessment_id:assessment
    };
    const ctx={
      targetBinding:{source:'git',revision},
      assessmentBinding:{assessmentId:assessment}
    };
    const run=async(sql,params=[])=>{
      queries.push({sql,params});
      if(sql.includes('FROM arl_workbench_tickets WHERE id=$1'))
        return {rows:[{id:ticket,ticket_number:'ARL-2026-000002',
          title:'Synthetic pilot',status:'scoping',archived_at:null,
          assigned_to:'emprex',linked_project_id:null,linked_assessment_id:null}]};
      if(sql.includes('FROM security_projects p JOIN users u'))
        return {rows:[candidate]};
      if(sql.includes('FROM system_snapshots'))
        return {rows:[{id:snapshot,assessment_configuration_json:ctx}]};
      return {rows:[]};
    };
    const pool={query:run,connect:async()=>({query:run,release(){}})};
    const preflight=await (await import('../desktop/enkyron-ticket-assessment.mjs'))
      .assessmentPreflight(pool,{ticket_id:ticket,repository_path:dir},'emprex');
    assert.equal(preflight.mode,'link_existing');
    assert.equal(preflight.project.snapshotId,snapshot);
    const linked=await linkOrCreateTicketAssessment(pool,{
      ticket_id:ticket,repository_path:dir,expected_sha:revision,
      operation:'link_existing',confirmed:true
    },'emprex');
    assert.equal(linked.linked,true);
    const event=queries.find(q=>q.sql.includes('INSERT INTO arl_workbench_ticket_events'));
    assert.ok(event);
    assert.match(event.sql,/note_added/);
    assert.ok(queries.some(q=>q.sql.includes('INSERT INTO arl_workbench_notes')));
    assert.ok(queries.some(q=>q.sql.includes("target_kind='git'")));
    assert.ok(queries.some(q=>q.sql.trim()==='COMMIT'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('linked current assessment is inspectable without any Master Dossier query',async()=>{
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-existing-read-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'});
  try {
    git('init','-q');
    git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic Test');
    fs.writeFileSync(path.join(dir,'README.txt'),'test fixture\n');
    git('add','README.txt');git('commit','-qm','test');
    const sha=frozenLocalTarget(dir).sha;
    const project='prj_fixture_2',assessment='asm_fixture_2',snapshot='sys_fixture_2';
    const queries=[];
    let projectId=project, expectedRevision=sha;
    const pool={query:async(sql)=>{
      queries.push(sql);
      if(sql.includes('FROM arl_workbench_tickets'))return {rows:[{
        id:ticket,ticket_number:'ARL-2026-000002',
        target_kind:'git',target_reference:dir,
        linked_project_id:project,linked_assessment_id:assessment
      }]};
      if(sql.includes('FROM security_projects'))return {rows:[{
        id:projectId,name:'fixture',agent_assessment_id:assessment
      }]};
      if(sql.includes('FROM system_snapshots'))return {rows:[{
        id:snapshot,assessment_configuration_json:JSON.stringify({
          targetBinding:{source:'git',revision:expectedRevision},
          assessmentBinding:{assessmentId:assessment}
        })
      }]};
      throw Error('Unexpected query: '+sql);
    }};
    const verified=await readLinkedAssessmentContext(pool,ticket);
    assert.equal(verified.available,true);
    assert.equal(verified.snapshot_id,snapshot);
    assert.equal(verified.target_sha,sha);
    assert.equal(verified.master_validation,'not_performed');
    assert.ok(!queries.some(q=>q.includes('assessment_master_dossier_revisions')));

    projectId='prj_another_target';
    await assert.rejects(readLinkedAssessmentContext(pool,ticket),
      /ticket does not match/);
    projectId=project;
    expectedRevision='0'.repeat(40);
    await assert.rejects(readLinkedAssessmentContext(pool,ticket),
      /current snapshot is not bound/);

    expectedRevision=sha;
    fs.writeFileSync(path.join(dir,'not-committed.txt'),'dirty');
    await assert.rejects(readLinkedAssessmentContext(pool,ticket),
      /uncommitted or untracked/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('no linked assessment is refused before any inspection',async()=>{
  const pool={query:async(sql)=>({rows:[{
    id:ticket,target_kind:'other',target_reference:'intake:manual',
    linked_project_id:null,linked_assessment_id:null
  }]})};
  await assert.rejects(readLinkedAssessmentContext(pool,ticket),
    /no linked local Git assessment/);
});
