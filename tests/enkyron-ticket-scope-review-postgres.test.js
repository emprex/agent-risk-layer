// Disposable PostgreSQL integration only. No production tickets are created.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readTicketScopeReview,recordTicketScopeReview}
  from '../desktop/enkyron-ticket-scope-review.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function connection(){
  assert.equal(process.env.CI,'true');
  const parsed=new URL(url);
  assert.equal(parsed.hostname,'127.0.0.1');
  assert.equal(parsed.pathname,'/arl_ci');
  assert.equal(parsed.username,'arl_ci');
  assert.equal(parsed.password,'synthetic-ci-only');
  return url;
}
test('snapshot-bound scope review revisions persist in real PostgreSQL with no test grants',{
  skip:!url&&'Disposable CI PostgreSQL only',
  timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:connection(),max:1});
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-scope-ci-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{
    encoding:'utf8',stdio:'pipe'
  }).trim();
  const actor=os.userInfo().username;
  try {
    git('init','-q');
    git('config','user.name','CI synthetic');
    git('config','user.email','ci@example.invalid');
    fs.writeFileSync(path.join(dir,'README.md'),'Disposable review scope.\n');
    git('add','README.md');
    git('commit','-qm','frozen');
    const sha=git('rev-parse','HEAD');
    const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
    const project='prj_ci_technical_scope',assessment='asm_ci_technical_scope';
    const snapshot='sys_ci_technical_scope';
    const scope={available:true,project_id:project,assessment_id:assessment,
      snapshot_id:snapshot,target_sha:sha,target_reference:dir};
    await pool.query(
      'CREATE TEMP TABLE arl_workbench_tickets ('+
      'id TEXT,assigned_to TEXT,assessor_name TEXT,status TEXT,'+
      'archived_at TIMESTAMPTZ,target_kind TEXT,linked_project_id TEXT,'+
      'linked_assessment_id TEXT,target_reference TEXT);'+
      'CREATE TEMP TABLE system_snapshots ('+
      'id TEXT,project_id TEXT,status TEXT,assessment_configuration_json JSONB);'+
      'CREATE TEMP TABLE enkyron_ticket_scope_reviews ('+
      'LIKE public.enkyron_ticket_scope_reviews INCLUDING ALL);'
    );
    await pool.query(
      'INSERT INTO arl_workbench_tickets VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [ticket,actor,actor,'scoping',null,'git',project,assessment,dir]
    );
    await pool.query(
      'INSERT INTO system_snapshots VALUES ($1,$2,$3,$4)',
      [snapshot,project,'current',JSON.stringify({
        assessmentBinding:{assessmentId:assessment},
        targetBinding:{source:'git',revision:sha}
      })]
    );
    const deps={scopeReader:async()=>scope};
    const blank=await readTicketScopeReview(pool,ticket,actor,deps);
    assert.equal(blank.available,true);
    assert.equal(blank.expected_revision,0);
    assert.equal(blank.tests_authorised,false);
    const payload={
      ticket_id:ticket,snapshot_id:snapshot,target_sha:sha,
      expected_revision:0,decision:'scope_draft',confirmed:true,
      technical_owner:'Internal laboratory owner',
      owner_authority_basis:'Accountable control over the internal demonstration repository.',
      included_scope:'Frozen local source and repository configuration only; no network connections.',
      excluded_scope:'Public hosts, other companies and the production environment.',
      environment:'Local isolated demonstration environment',
      permitted_methods:'Source code reading and static metadata inspection only.',
      prohibited_methods:'Active exploitation, external scanning and destructive execution are forbidden.',
      rules_of_engagement:'Stop when source SHA changes, evidence is missing or the technical owner withdraws permission.',
      owner_permission_reference:'',
      rationale:'A precise initial scope is required before requesting active testing.'
    };
    const first=await recordTicketScopeReview(pool,payload,actor,deps);
    assert.equal(first.saved,true);
    assert.equal(first.revision,1);
    assert.equal(first.tests_authorised,false);
    const read=await readTicketScopeReview(pool,ticket,actor,deps);
    assert.equal(read.expected_revision,1);
    assert.equal(read.current_revision_binding,true);
    assert.equal(read.latest.included_scope,payload.included_scope);
    assert.equal(read.tests_authorised,false);
    await assert.rejects(
      recordTicketScopeReview(pool,payload,actor,deps),/concurrent review recorded/
    );
    const second=await recordTicketScopeReview(pool,{
      ...payload,expected_revision:1,decision:'active_test_authorisation_pending',
      owner_permission_reference:'ROE-CI-TEST-001',
      rationale:'Requested an owner approval reference for later independent canonical verification.'
    },actor,deps);
    assert.equal(second.revision,2);
    assert.equal(second.tests_authorised,false);
    const count=await pool.query(
      'SELECT COUNT(*)::integer AS total FROM enkyron_ticket_scope_reviews WHERE ticket_id=$1',
      [ticket]
    );
    assert.equal(count.rows[0].total,2);
    const historical=await pool.query(
      'SELECT revision,decision FROM enkyron_ticket_scope_reviews WHERE ticket_id=$1 ORDER BY revision',
      [ticket]
    );
    assert.deepEqual(historical.rows.map(x=>x.decision),
      ['scope_draft','active_test_authorisation_pending']);
    const original=await pool.query(
      'SELECT status FROM arl_workbench_tickets WHERE id=$1',[ticket]
    );
    assert.equal(original.rows[0].status,'scoping');
  }finally{
    await pool.end();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
