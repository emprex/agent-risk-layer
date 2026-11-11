import test from 'node:test';
import assert from 'node:assert/strict';
import {mailLinkSent,validateMailLinkRequest,mailSent}
  from '../desktop/enkyron-mail-service.mjs';

const draftId='11111111-2222-4333-8444-555555555555';
const companyId='22222222-3333-4444-8555-666666666666';
const contactId='33333333-4444-4555-8666-777777777777';
const input={draft_id:draftId,company_id:companyId,contact_id:contactId,confirmed:true};

test('Linking submitted message requires explicit typed IDs and confirmation',()=>{
  assert.deepEqual(validateMailLinkRequest(input),{
    draftId,companyId,contactId
  });
  for(const invalid of [{...input,confirmed:false},{...input,draft_id:'bad'},
    {...input,company_id:'bad'},{...input,contact_id:'bad'},{}])
    assert.throws(()=>validateMailLinkRequest(invalid),/CRM/);
});

test('Linking sent record only updates CRM metadata, appends audit and never resends',async()=>{
  const statements=[];
  const pool={connect:async()=>({
    query:async(sql,params=[])=>{
      statements.push({sql,params});
      if(sql.includes('FROM enkyron_crm_mail_drafts d JOIN enkyron_mail_send_attempts'))
        return {rows:[{id:draftId,company_id:null,opportunity_id:null,
          recipient_email:'sam@get-zeus.com',subject:'Security assessment',
          body_text:'Hello',mailbox_key:'direction',revision:1}]};
      if(sql.includes('SELECT c.company_id'))return {rows:[{company_id:companyId}]};
      if(sql.includes('SELECT c.id FROM enkyron_crm_contacts'))
        return {rows:[{id:contactId}]};
      return {rows:[]};
    },
    release:()=>{}
  })};
  const linked=await mailLinkSent(pool,'ci-owner',input,{
    uuid:()=> '44444444-5555-4666-8777-888888888888'
  });
  assert.equal(linked.linked,true);
  assert.equal(linked.revision,2);
  assert.equal(statements[0].sql,'BEGIN');
  assert.equal(statements.at(-1).sql,'COMMIT');
  const update=statements.find(x=>x.sql.startsWith('UPDATE enkyron_crm_mail_drafts'));
  assert.deepEqual(update.params,['local:ci-owner',draftId,companyId,2,'ci-owner']);
  const event=statements.find(x=>x.sql.startsWith('INSERT INTO enkyron_crm_mail_draft_events'));
  assert.equal(event.params[3],2);
  assert.match(event.params[4],/^[a-f0-9]{64}$/);
  assert.ok(!statements.some(x=>/INSERT INTO enkyron_mail_send_attempts/.test(x.sql)));
});

test('Ambiguous contact matching prevents any sent CRM association',async()=>{
  const statements=[];
  const pool={connect:async()=>({
    query:async(sql,params=[])=>{
      statements.push(sql);
      if(sql.includes('FROM enkyron_crm_mail_drafts d JOIN enkyron_mail_send_attempts'))
        return {rows:[{id:draftId,company_id:null,opportunity_id:null,
          recipient_email:'sam@get-zeus.com',revision:1}]};
      if(sql.includes('SELECT c.company_id'))
        return {rows:[{company_id:companyId},{company_id:companyId}]};
      return {rows:[]};
    },release:()=>{}
  })};
  await assert.rejects(()=>mailLinkSent(pool,'ci-owner',input),/unique active/);
  assert.equal(statements.at(-1),'ROLLBACK');
  assert.ok(!statements.some(x=>x.startsWith('UPDATE')));
});

test('Sent listing exposes CRM company only as recorded, not inferred',async()=>{
  let statement='';
  const fake={query:async(sql,params)=>{
    if(sql.includes('enkyron_local_mail_access'))return {rows:[
      {mailbox_key:'direction',role:'organization_owner_l5',can_read:true,can_send:true}
    ]};
    statement=sql;
    assert.deepEqual(params,['local:ci-owner']);
    return {rows:[{draft_id:draftId,company_name:'Zeus AI',company_id:companyId}]};
  }};
  const listed=await mailSent(fake,'ci-owner');
  assert.equal(listed.items[0].company_name,'Zeus AI');
  assert.match(statement,/LEFT JOIN enkyron_crm_companies/);
});
