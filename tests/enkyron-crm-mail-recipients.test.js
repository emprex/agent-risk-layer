import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recipientSearchTerm,suggestMailRecipients,uniqueCompanyForRecipient,
  verifiedContactForCompany
} from '../desktop/enkyron-crm-mail-recipients.mjs';
import {createMailDraft,validateDraftCreate} from '../desktop/enkyron-crm-mail-drafts.mjs';

const company='11111111-2222-4333-8444-555555555555';
const contact='22222222-3333-4444-8555-666666666666';
const draft='33333333-4444-4555-8666-777777777777';

test('bounded CRM address autocomplete never scans arbitrary workspaces',async()=>{
  assert.equal(recipientSearchTerm('s'),'');
  assert.equal(recipientSearchTerm(' Sam '),'Sam');
  assert.throws(()=>recipientSearchTerm('a'.repeat(121)),/CRM/);
  assert.throws(()=>recipientSearchTerm('x\nBcc:'),/CRM/);
  const queries=[];
  const pool={query:async(sql,params)=>{
    queries.push({sql,params});
    return {rows:[{contact_id:contact,company_id:company,
      full_name:'Sam Oliver',job_title:'CEO',
      email:'sam@get-zeus.com',company_name:'Zeus AI'}]};
  }};
  assert.deepEqual((await suggestMailRecipients(pool,'S','ci-operator')).items,[]);
  assert.equal(queries.length,0);
  const result=await suggestMailRecipients(pool,'  Sam  ','ci-operator');
  assert.equal(result.items[0].full_name,'Sam Oliver');
  assert.deepEqual(queries[0].params,['local:ci-operator','Sam']);
  assert.match(queries[0].sql,/LIMIT 13/);
  assert.match(queries[0].sql,/workspace_key=\$1/);
  assert.ok(!queries[0].sql.includes('Sam'));
  assert.equal(result.more,false);
});

test('exact recipient binding is unique-only and rejects mismatched contact',async()=>{
  const actor='ci-operator',email='sam@get-zeus.com';
  const pool={query:async(_sql,params)=>({rows:
    params.length===2?[{company_id:company}]:[{id:contact}]})};
  assert.equal(await uniqueCompanyForRecipient(pool,email,actor),company);
  assert.equal(await verifiedContactForCompany(pool,contact,company,email,actor),true);
  assert.equal(await uniqueCompanyForRecipient({
    query:async()=>({rows:[{company_id:company},{company_id:company}]})
  },email,actor),null);
  await assert.rejects(()=>verifiedContactForCompany({
    query:async()=>({rows:[]})
  },contact,company,email,actor),/no longer matches/);
  assert.equal(await uniqueCompanyForRecipient(pool,'bad address',actor),null);
});

test('new standalone mail draft associates exact unique CRM address, without sending',async()=>{
  const queries=[];
  let uuidCount=0;
  const ids=[draft,'44444444-5555-4666-8777-888888888888'];
  const pool={connect:async()=>({
    query:async(sql,params=[])=>{
      queries.push({sql,params});
      if(sql.includes('SELECT c.company_id FROM enkyron_crm_contacts'))
        return {rows:[{company_id:company}]};
      if(sql.includes('FROM enkyron_crm_companies WHERE workspace_key'))
        return {rows:[{id:company}]};
      return {rows:[]};
    },release:()=>{}
  })};
  const result=await createMailDraft(pool,{
    mailbox_key:'direction',recipient_email:'sam@get-zeus.com',
    subject:'Security assessment',body_text:'Hello'
  },'ci-operator',{uuid:()=>ids[uuidCount++]});
  assert.equal(result.company_id,company);
  const insert=queries.find(q=>q.sql.startsWith('INSERT INTO enkyron_crm_mail_drafts'));
  assert.equal(insert.params[3],company);
  assert.equal(insert.params[5],'sam@get-zeus.com');
  assert.ok(!queries.some(q=>/enkyron_mail_send_attempts/.test(q.sql)));

  assert.throws(()=>validateDraftCreate({
    company_id:company,recipient_contact_id:'invalid',
    mailbox_key:'direction',recipient_email:'sam@get-zeus.com',
    subject:'Hi',body_text:'Hello'
  }),/CRM/);
});
