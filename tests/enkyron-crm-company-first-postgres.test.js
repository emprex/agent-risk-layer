import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {recordActivity} from '../desktop/enkyron-crm-activities.mjs';
import {createMailDraft,readMailDraft,updateMailDraft,listMailDrafts}
  from '../desktop/enkyron-crm-mail-drafts.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only CI synthetic database is writable');
  const uri=new URL(url);
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(uri.pathname,'/arl_ci');
  assert.equal(uri.username,'arl_ci');
  assert.equal(uri.password,'synthetic-ci-only');
  return url;
}

test('company-first note and draft need no opportunity; provenance and isolation remain enforced',{
  skip:!url&&'Disposable PostgreSQL only',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-cofirst-'+randomUUID().slice(0,8);
  const other='ci-other-'+randomUUID().slice(0,8);
  try{
    const company=await createCompany(pool,{
      name:'Synthetic company-first '+randomUUID().slice(0,8),
      city:'London',country:'United Kingdom'
    },actor);
    const note=await recordActivity(pool,{
      company_id:company.id,activity_type:'note',reviewed:true,
      detail:'Company research entered without creating a commercial opportunity.'
    },actor);
    assert.equal(note.company_id,company.id);
    assert.equal(note.opportunity_id,null);
    const draft=await createMailDraft(pool,{
      company_id:company.id,recipient_email:'public@example.invalid',
      subject:'Private introduction draft',
      body_text:'Hello, this is a local draft and has not been sent.'
    },actor);
    assert.equal(draft.company_id,company.id);
    assert.equal(draft.opportunity_id,null);
    const record=await readMailDraft(pool,draft.id,actor);
    assert.equal(record.draft.company_id,company.id);
    assert.equal(record.draft.opportunity_id,null);
    assert.match(record.draft.body_text,/not been sent/);
    const listed=await listMailDrafts(pool,'Private introduction',actor);
    assert.ok(listed.items.some(x=>x.id===draft.id&&x.company_id===company.id));
    assert.ok(listed.items.every(x=>!Object.hasOwn(x,'body_text')));
    const dossier=await getCompanyDossier(pool,company.id,actor);
    assert.equal(dossier.sections.opportunities.total,0);
    assert.equal(dossier.sections.activities.total,1);
    assert.equal(dossier.sections.activities.items[0].id,note.id);
    assert.equal(dossier.sections.drafts.total,1);
    assert.equal(dossier.sections.drafts.items[0].id,draft.id);
    const edit=await updateMailDraft(pool,{
      id:draft.id,expected_revision:1,
      recipient_email:'public@example.invalid',
      subject:'Revised private introduction draft',
      body_text:'Revised text kept locally, no external delivery.'
    },actor);
    assert.equal(edit.revision,2);
    const events=(await pool.query(
      'SELECT revision,event_type,content_sha256 FROM enkyron_crm_mail_draft_events '+
      'WHERE workspace_key=$1 AND draft_id=$2 ORDER BY revision',
      ['local:'+actor,draft.id]
    )).rows;
    assert.deepEqual(events.map(e=>e.revision),[1,2]);
    assert.ok(events.every(e=>/^[a-f0-9]{64}$/.test(e.content_sha256)));
    await assert.rejects(()=>recordActivity(pool,{
      company_id:company.id,activity_type:'note',reviewed:true,
      detail:'An unrelated local operator tried to write another company note.'
    },other),/company not found/);
    await assert.rejects(()=>createMailDraft(pool,{
      company_id:company.id,subject:'Cross-workspace attempt',body_text:''
    },other),/company not found/);
    await assert.rejects(()=>readMailDraft(pool,draft.id,other),/draft not found/);
    await assert.rejects(()=>getCompanyDossier(pool,company.id,other),/company not found/);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_crm_activities SET detail=$1 WHERE id=$2',
      ['Unauthorized edit of immutable source note',note.id]
    ),/cannot be changed or deleted/);
    const saved=(await pool.query(
      'SELECT opportunity_id,company_id FROM enkyron_crm_activities WHERE id=$1',[note.id]
    )).rows[0];
    assert.equal(saved.opportunity_id,null);
    assert.equal(saved.company_id,company.id);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunities WHERE workspace_key=$1',
      ['local:'+actor]
    )).rows[0].n,0,'No synthetic opportunity was manufactured');
  }finally{await pool.end();}
});
