import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMailReplyRequest,replyRecipientFromMessage,mailReplyDraft}
  from '../desktop/enkyron-mail-service.mjs';

const draftId='11111111-1111-4111-8111-111111111111';
const threadId='22222222-2222-4222-8222-222222222222';
const emailId='33333333-3333-4333-8333-333333333333';
const inboxId='44444444-4444-4444-8444-444444444444';
const deliveredId='55555555-5555-4555-8555-555555555555';
const OWNER='guillaume.strohecker@agentrisklayer.com';
const external='client@example.invalid';
const input={draft_id:draftId,expected_revision:1,mailbox:'direction',
  thread_id:threadId,email_id:emailId,confirmed:true,recipient_verified:true};

test('native reply requires explicit confirmation and exact scoped IDs',()=>{
  assert.deepEqual(validateMailReplyRequest(input),{
    draftId,revision:1,mailbox:'direction',threadId,emailId
  });
  for(const changed of [{confirmed:false},{recipient_verified:false},
    {mailbox:'other'},{thread_id:'other'},{email_id:'other'}]){
    assert.throws(()=>validateMailReplyRequest({...input,...changed}));
  }
});

test('recipient derived from verified Reply-To, never from model or caller',()=>{
  assert.equal(replyRecipientFromMessage({from:'Customer <client@example.invalid>',
    reply_to:['Assistant <assistant@example.invalid>']},OWNER),
    'assistant@example.invalid');
  assert.equal(replyRecipientFromMessage({from:'Customer <client@example.invalid>'},OWNER),
    external);
  assert.throws(()=>replyRecipientFromMessage({
    from:'Customer <client@example.invalid>',
    reply_to:['one@example.invalid','two@example.invalid']},OWNER),/multiple/);
  assert.throws(()=>replyRecipientFromMessage({from:OWNER},OWNER),/safely/);
  assert.throws(()=>replyRecipientFromMessage({from:'attacker@example.invalid\r\nBcc:evil@example.invalid'},OWNER));
});

function harness({dbRecipient=external,localSender=external,granted=true}={}){
  let reserved=false;
  const provider=[];
  const client={
    async query(sql,args){
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
      if(sql.startsWith('SELECT sender FROM enkyron_mail_local_messages'))
        return {rows:localSender?[{sender:localSender}]:[]};
      if(sql.startsWith('SELECT id,revision,mailbox_key'))
        return {rows:[{id:draftId,revision:1,mailbox_key:'direction',
          recipient_email:dbRecipient,subject:'Re: Security review',body_text:'Yes, thanks.'}]};
      if(sql.startsWith('SELECT can_send,can_read'))
        return {rows:[{can_send:granted,can_read:granted}]};
      if(sql.startsWith('SELECT id FROM enkyron_mail_send_attempts'))
        return {rows:reserved?[{id:'existing'}]:[]};
      if(sql.startsWith('SELECT id FROM enkyron_crm_mail_manual_sends'))
        return {rows:[]};
      if(sql.startsWith('INSERT INTO enkyron_mail_send_attempts')){
        reserved=true;return {rows:[]};
      }
      throw new Error('Unexpected client query: '+sql);
    },
    release(){}
  };
  const pool={
    async query(sql,args){
      if(sql.startsWith('SELECT mailbox_key,role,can_read,can_send'))
        return {rows:[{mailbox_key:'direction',role:'organization_owner_l5',
          can_read:granted,can_send:granted}]};
      if(sql.startsWith('UPDATE enkyron_mail_send_attempts'))return {rows:[]};
      throw new Error('Unexpected pool query: '+sql);
    },
    async connect(){return client;}
  };
  return {
    pool,provider,get reserved(){return reserved;},
    options:{
      listMessages:async()=>({items:[{id:emailId,from:external,reply_to:[]}]}),
      credentialsLoader:async()=>({
        credentialProvider:async()=> 'test-only-secret',
        mailboxes:{direction:inboxId}
      }),
      uuid:()=>deliveredId,
      fetchImpl:async(url,options)=>{
        provider.push({url,options});
        return {ok:true,json:async()=>({id:deliveredId})};
      }
    }
  };
}

test('reply is sent only inside verified provider thread and cannot repeat',async()=>{
  const h=harness();
  const out=await mailReplyDraft(h.pool,'operator',input,h.options);
  assert.equal(out.outcome,'accepted');
  assert.equal(h.provider.length,1);
  assert.equal(h.provider[0].url,'https://api.resend.com/inboxes/'+inboxId+
    '/threads/'+threadId+'/emails/'+emailId+'/reply');
  assert.deepEqual(JSON.parse(h.provider[0].options.body),{text:'Yes, thanks.'});
  assert.equal(h.provider[0].options.headers['Idempotency-Key'],deliveredId);
  await assert.rejects(mailReplyDraft(h.pool,'operator',input,h.options),/already submitted/);
  assert.equal(h.provider.length,1);
});

test('reply fails closed for changed recipient or missing local source',async()=>{
  for(const config of [{dbRecipient:'wrong@example.invalid'},{localSender:null},
    {granted:false}]){
    const h=harness(config);
    await assert.rejects(mailReplyDraft(h.pool,'operator',input,h.options));
    assert.equal(h.provider.length,0);
    assert.equal(h.reserved,false);
  }
});
