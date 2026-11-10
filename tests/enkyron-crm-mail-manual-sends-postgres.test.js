import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createMailDraft,readMailDraft,listMailDrafts,updateMailDraft}
  from '../desktop/enkyron-crm-mail-drafts.mjs';
import {recordManualSend}
  from '../desktop/enkyron-crm-mail-manual-sends.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only a disposable synthetic CI database is writable');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('external send report preserves draft, isolates operator, blocks duplicates and edits',{
  skip:!url&&'Only disposable PostgreSQL',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-mail-send-'+randomUUID().slice(0,8);
  const other='ci-mail-other-'+randomUUID().slice(0,8);
  try{
    const company=await createCompany(pool,{
      name:'Synthetic email reconciliation '+randomUUID().slice(0,8)
    },actor);
    const draft=await createMailDraft(pool,{
      company_id:company.id,
      recipient_email:'buyer@example.invalid',
      subject:'Synthetic outreach',
      body_text:'This draft is preserved after an operator report.'
    },actor);
    const id='ci-msg-'+randomUUID();
    const report={
      draft_id:draft.id,expected_revision:1,provider:'other',
      provider_message_id:id,sender_email:'operator@example.invalid',
      sent_at:'2026-11-10T07:52:16Z',confirmed:true
    };
    await assert.rejects(()=>recordManualSend(pool,report,other),/not found/);
    const saved=await recordManualSend(pool,report,actor);
    assert.equal(saved.draft_id,draft.id);
    const read=await readMailDraft(pool,draft.id,actor);
    assert.equal(read.draft.mail_state,'external_send_reported');
    assert.equal(read.draft.sent_draft_revision,1);
    assert.equal(read.draft.manual_message_id,id);
    assert.equal(read.draft.body_text,
      'This draft is preserved after an operator report.');
    const listed=await listMailDrafts(pool,'Synthetic outreach',actor);
    const entry=listed.items.find(x=>x.id===draft.id);
    assert.equal(entry.mail_state,'external_send_reported');
    assert.equal('body_text' in entry,false);
    assert.equal((await listMailDrafts(pool,'Synthetic outreach',other)).items.length,0);
    const dossier=await getCompanyDossier(pool,company.id,actor);
    assert.equal(dossier.sections.opportunities.total,0);
    assert.equal(dossier.sections.drafts.total,1);
    assert.equal(dossier.sections.drafts.items[0].send_state,'External send reported');
    await assert.rejects(()=>recordManualSend(pool,report,actor),/already/);
    await assert.rejects(()=>updateMailDraft(pool,{
      id:draft.id,expected_revision:1,
      recipient_email:'buyer@example.invalid',
      subject:'Edited sent claim',body_text:'Changed local draft'
    },actor),/cannot be edited/);
    const duplicateDraft=await createMailDraft(pool,{
      company_id:company.id,recipient_email:'other@example.invalid',
      subject:'Second synthetic draft',body_text:'Not actually sent'
    },actor);
    await assert.rejects(()=>recordManualSend(pool,{
      ...report,draft_id:duplicateDraft.id,expected_revision:1
    },actor),/reference already recorded/);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_mail_manual_sends WHERE id=$1',[saved.id]
    ),/cannot be changed or deleted/);
    const revisions=(await pool.query(
      'SELECT revision,event_type FROM enkyron_crm_mail_draft_events '
      +'WHERE workspace_key=$1 AND draft_id=$2 ORDER BY revision',
      ['local:'+actor,draft.id]
    )).rows;
    assert.deepEqual(revisions.map(e=>e.event_type),['created']);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1',['local:'+actor]
    )).rows[0].n,0);
  }finally{await pool.end();}
});
