import test from 'node:test';
import assert from 'node:assert/strict';
import {mailThreadSendReview,mailReplyDraft} from '../desktop/enkyron-mail-service.mjs';

const thread='11111111-2222-4333-8444-555555555555';
const email='22222222-3333-4444-8555-666666666666';
const draftId='33333333-4444-4555-8666-777777777777';
const delivered='55555555-6666-4777-8888-999999999999';
const inboxId='66666666-7777-4888-9999-aaaaaaaaaaaa';
const source={id:email,direction:'inbound',
 from:'Customer <customer@example.invalid>',
 reply_to:['reply@example.invalid'],
 to:['support@agentrisklayer.com','colleague@example.invalid'],
 cc:['manager@example.invalid'],bcc:['original-hidden@example.invalid']};
const body='Synthetic Reply All, not a real email.';
const request={mailbox:'support',thread_id:thread,email_id:email,
 reply_all:true,additional_cc:['new@example.invalid'],
 additional_bcc:['private@example.invalid'],text:body};
function fixture(overrides={}){
 const state={posts:[],attempts:0,prior:false,access:true};
 const chosen={...source,...(overrides.source||{})};
 const sourceLoader=async()=>chosen;
 const clients={
  async query(sql,args=[]){
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   if(sql.startsWith('SELECT sender FROM enkyron_mail_local_messages'))
     return {rows:[{sender:source.from}]};
   if(sql.startsWith('SELECT id,revision,mailbox_key,recipient_email,subject,body_text'))
     return {rows:[{
       id:draftId,revision:overrides.revision||1,mailbox_key:'support',
       recipient_email:'reply@example.invalid',subject:'Re: Inquiry',
       body_text:overrides.body||body,
       to_recipients:['reply@example.invalid'],
       cc_recipients:overrides.cc||[
         'colleague@example.invalid','manager@example.invalid','new@example.invalid'],
       bcc_recipients:['private@example.invalid']}]};
   if(sql.startsWith('SELECT can_send,can_read FROM enkyron_local_mail_access'))
     return {rows:[{can_send:state.access,can_read:state.access}]};
   if(sql.startsWith('SELECT id FROM enkyron_mail_send_attempts'))
     return {rows:state.prior?[{id:'existing'}]:[]};
   if(sql.startsWith('SELECT id FROM enkyron_crm_mail_manual_sends'))
     return {rows:[]};
   if(sql.startsWith('INSERT INTO enkyron_mail_send_attempts')){
     state.attempts++;state.prior=true;return {rows:[]};
   }
   throw Error('Unexpected synthetic client SQL: '+sql);
  },release(){} };
 const pool={
  async connect(){return clients;},
  async query(sql,args){
   if(sql.startsWith('SELECT mailbox_key,role,can_read,can_send'))
     return {rows:[{mailbox_key:'support',role:'organization_owner_l5',
       can_read:state.access,can_send:state.access}]};
   if(sql.startsWith('SELECT sender FROM enkyron_mail_local_messages'))
     return {rows:[{sender:source.from}]};
   if(sql.startsWith('UPDATE enkyron_mail_send_attempts'))
     return {rows:[]};
   throw Error('Unexpected synthetic pool SQL: '+sql);
  }
 };
 const options={getDetails:sourceLoader,
  credentialsLoader:async()=>({mailboxes:{support:inboxId},
    credentialProvider:async()=>'synthetic-secret'}),
  fetchImpl:async(url,opts)=>{state.posts.push({url,opts});
    return {ok:true,json:async()=>({id:delivered})};}
 };
 return {pool,options,state,sourceLoader};
}
async function review(h,req=request){return mailThreadSendReview(h.pool,'operator',req,h.options);}
function payload(snapshot){return {draft_id:draftId,expected_revision:1,
 mailbox:'support',thread_id:thread,email_id:email,
 recipient_verified:true,confirmed:true,
 confirmation_sha256:snapshot.confirmation_sha256,
 reply_review:snapshot,reply_all:true,
 additional_cc:request.additional_cc,
 additional_bcc:request.additional_bcc};}
test('M03-J review is non-sending and excludes original BCC',async()=>{
 const h=fixture();const result=await review(h);
 assert.equal(h.state.posts.length,0);assert.equal(h.state.attempts,0);
 assert.equal(result.mailbox,'support');
 assert.deepEqual(result.to,['reply@example.invalid']);
 assert.deepEqual(result.cc,['colleague@example.invalid',
   'manager@example.invalid','new@example.invalid']);
 assert.deepEqual(result.bcc,['private@example.invalid']);
 assert.ok(!JSON.stringify(result).includes('original-hidden@example.invalid'));
});
test('M03-J posts only reviewed CC/BCC in the existing thread',async()=>{
 const h=fixture();const snapshot=await review(h);
 const result=await mailReplyDraft(h.pool,'operator',payload(snapshot),h.options);
 assert.equal(result.outcome,'accepted');assert.equal(h.state.attempts,1);
 assert.equal(h.state.posts.length,1);
 const {url,opts}=h.state.posts[0];
 assert.equal(url,'https://api.resend.com/inboxes/'+inboxId+
  '/threads/'+thread+'/emails/'+email+'/reply');
 const sent=JSON.parse(opts.body);
 assert.deepEqual(sent,{text:body,cc:snapshot.cc,bcc:snapshot.bcc});
 assert.equal(sent.reply_all,undefined);
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),
  /already submitted/);
 assert.equal(h.state.posts.length,1);
});
test('M03-J rejects changed provider recipients after review',async()=>{
 const h=fixture();const snapshot=await review(h);
 h.options.getDetails=async()=>({...source,cc:['changed@example.invalid']});
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),/review again/);
 assert.equal(h.state.attempts,0);assert.equal(h.state.posts.length,0);
});
test('M03-J rejects edited stored reply text',async()=>{
 const h=fixture({body:'Changed body'});const snapshot=await review(h);
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),/review again/);
 assert.equal(h.state.attempts,0);
});
test('M03-J rejects changed saved CC',async()=>{
 const h=fixture({cc:['unreviewed@example.invalid']});const snapshot=await review(h);
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),/review again/);
 assert.equal(h.state.attempts,0);
});
test('M03-J rejects stale draft revision',async()=>{
 const h=fixture({revision:2});const snapshot=await review(h);
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),/draft or recipient changed/);
 assert.equal(h.state.attempts,0);
});
test('M03-J rejects denied send permission',async()=>{
 const h=fixture();const snapshot=await review(h);h.state.access=false;
 await assert.rejects(mailReplyDraft(h.pool,'operator',payload(snapshot),h.options),/permission/);
 assert.equal(h.state.attempts,0);
});
test('M03-J rejects fake confirmation hash',async()=>{
 const h=fixture();const snapshot=await review(h);const p=payload(snapshot);
 p.confirmation_sha256='0'.repeat(64);
 await assert.rejects(mailReplyDraft(h.pool,'operator',p,h.options),/reviewed reply required/);
 assert.equal(h.state.attempts,0);
});
test('M03-J refuses original outbound messages',async()=>{
 const h=fixture({source:{direction:'outbound'}});
 await assert.rejects(review(h),/inbound/);
 assert.equal(h.state.posts.length,0);
});
test('M03-J uncertain provider status, never retries',async()=>{
 const h=fixture();const snapshot=await review(h);
 h.options.fetchImpl=async(url,opts)=>{
   h.state.posts.push({url,opts});throw Error('synthetic timeout');};
 const result=await mailReplyDraft(h.pool,'operator',payload(snapshot),h.options);
 assert.equal(result.outcome,'uncertain');
 assert.equal(h.state.posts.length,1);assert.equal(h.state.attempts,1);
});
