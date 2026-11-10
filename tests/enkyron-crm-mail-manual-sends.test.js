import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManualSend,recordManualSend}
  from '../desktop/enkyron-crm-mail-manual-sends.mjs';
import {updateMailDraft} from '../desktop/enkyron-crm-mail-drafts.mjs';

const id='11111111-2222-4333-8444-555555555555';
const request={
  draft_id:id,expected_revision:2,provider:'gmail',
  provider_message_id:'1a1c471873dd80f1',
  sender_email:'operator@example.invalid',
  sent_at:'2026-11-10T07:52:16Z',confirmed:true
};
test('operator send report validates provenance, exact revision and timestamp',()=>{
  assert.deepEqual(validateManualSend(request),request);
  for(const bad of [
    null,{},[],{...request,draft_id:'bad'},
    {...request,expected_revision:0},
    {...request,provider:'imap-synced'},
    {...request,provider_message_id:'a'},
    {...request,provider_message_id:'x\nBcc:bad'},
    {...request,sender_email:'bad@invalid,another@example.invalid'},
    {...request,sent_at:'2026-11-10'},
    {...request,sent_at:'2099-01-01T00:00:00Z'},
    {...request,confirmed:false}
  ]) assert.throws(()=>validateManualSend(bad),/CRM/);
});
test('manual report writes a single scoped immutable receipt in one transaction',async()=>{
  const calls=[];
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.startsWith('SELECT id,revision,recipient_email'))
        return {rows:[{id,revision:2,recipient_email:'buyer@example.invalid'}]};
      return {rows:[]};
    },release:()=>{calls.push({sql:'RELEASE'});}
  })};
  const result=await recordManualSend(pool,request,'ci-operator',{uuid:()=>'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});
  assert.equal(result.draft_id,id);
  assert.deepEqual(calls.map(x=>x.sql.match(/^[A-Z]+/)[0]),
    ['BEGIN','SELECT','SELECT','INSERT','COMMIT','RELEASE']);
  const receipt=calls[3];
  assert.equal(receipt.params[1],'local:ci-operator');
  assert.equal(receipt.params[7],'buyer@example.invalid');
  assert.equal(receipt.params[5],'1a1c471873dd80f1');
  assert.ok(!receipt.params.includes('body_text'));
  assert.ok(!calls.some(x=>/enkyron_crm_activities|\bSMTP\b|sendMail/.test(x.sql)));
});
test('stale, missing, blank-recipient and already-marked fail with rollback',async()=>{
  for(const kind of ['missing','stale','recipient','duplicate']){
    const sqls=[];
    const pool={connect:async()=>({
      query:async sql=>{
        sqls.push(sql);
        if(sql.startsWith('SELECT id,revision,recipient_email')){
          if(kind==='missing')return {rows:[]};
          return {rows:[{id,revision:kind==='stale'?3:2,
            recipient_email:kind==='recipient'?null:'buyer@example.invalid'}]};
        }
        if(sql.startsWith('SELECT id FROM enkyron_crm_mail_manual_sends'))
          return {rows:kind==='duplicate'?[{id:'exists'}]:[]};
        return {rows:[]};
      },release:()=>{}
    })};
    await assert.rejects(()=>recordManualSend(pool,request,'ci-operator'),/CRM/);
    assert.equal(sqls.at(-1),'ROLLBACK');
    assert.ok(!sqls.some(x=>x.startsWith('INSERT')));
  }
});
test('reported external send prevents later edits to the source draft',async()=>{
  const statements=[];
  const pool={connect:async()=>({
    query:async sql=>{
      statements.push(sql);
      if(sql.startsWith('SELECT id,recipient_email'))return {rows:[{
        id,revision:2,recipient_email:'buyer@example.invalid',
        subject:'Original',body_text:'Source text',
        external_send_reported:true
      }]};
      return {rows:[]};
    },release:()=>{}
  })};
  await assert.rejects(()=>updateMailDraft(pool,{
    id,expected_revision:2,recipient_email:'buyer@example.invalid',
    subject:'Edited after send',body_text:'Changed'
  },'ci-operator'),/cannot be edited/);
  assert.equal(statements.at(-1),'ROLLBACK');
  assert.ok(!statements.some(x=>x.startsWith('UPDATE')));
});
