import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewProfessionalSendDraft,validateProfessionalReviewRequest}
 from '../desktop/enkyron-mail-professional-review.mjs';
import {professionalPayloadFingerprint}
 from '../desktop/enkyron-mail-professional-payload.mjs';
const id='11111111-1111-4111-8111-111111111111';
const draft={id,revision:2,mailbox_key:'direction',
  recipient_email:'alice@example.test',
  to_recipients:['alice@example.test','bob@example.test'],
  cc_recipients:['carol@example.test'],
  bcc_recipients:['hidden@example.test'],
  subject:'Synthetic email',body_text:'Synthetic offline review'};
function fixture(options={}){
  const state={queries:[],posts:0,released:false};
  const client={
    async query(sql,args=[]){
      state.queries.push(sql);
      if(['BEGIN READ ONLY','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
      if(sql.startsWith('SELECT id,revision,mailbox_key'))
        return {rows:args[0]==='local:operator'?[{...draft,...options.draft}]:[]};
      if(sql.startsWith('SELECT can_send FROM'))
        return {rows:[{can_send:options.granted!==false}]};
      if(sql.startsWith('SELECT id FROM enkyron_mail_send_attempts'))
        return {rows:options.attempt?[{id:'attempt'}]:[]};
      if(sql.startsWith('SELECT id FROM enkyron_crm_mail_manual_sends'))
        return {rows:options.manual?[{id:'record'}]:[]};
      throw Error('Unexpected SQL: '+sql);
    },release(){state.released=true;}
  };
  return {state,pool:{async connect(){return client;}}};
}
const request={draft_id:id,expected_revision:2};
test('M03-I review reads the exact saved draft without sending',async()=>{
  const h=fixture();
  const r=await reviewProfessionalSendDraft(h.pool,'operator',request);
  assert.equal(r.revision,2);
  assert.deepEqual(r.payload.to,draft.to_recipients);
  assert.deepEqual(r.payload.cc,draft.cc_recipients);
  assert.deepEqual(r.payload.bcc,draft.bcc_recipients);
  assert.equal(r.confirmation_sha256,professionalPayloadFingerprint(r.payload));
  assert.ok(h.state.queries.includes('BEGIN READ ONLY'));
  assert.ok(h.state.queries.includes('COMMIT'));
  assert.ok(!h.state.queries.some(s=>/INSERT|UPDATE|DELETE|https:\/\//i.test(s)));
  assert.equal(h.state.posts,0);
  assert.equal(h.state.released,true);
});
test('M03-I review rejects stale revisions and unauthorized workspaces',async()=>{
  for(const [o,user] of [[{draft:{revision:3}},'operator'],[{},'elsewhere']]){
    const h=fixture(o);
    await assert.rejects(reviewProfessionalSendDraft(h.pool,user,request));
    assert.ok(h.state.queries.includes('ROLLBACK'));
    assert.equal(h.state.released,true);
  }
});
test('M03-I review refuses already submitted, reported or ungranted drafts',async()=>{
  for(const o of [{attempt:true},{manual:true},{granted:false}]){
    const h=fixture(o);
    await assert.rejects(reviewProfessionalSendDraft(h.pool,'operator',request));
    assert.ok(h.state.queries.includes('ROLLBACK'));
  }
});
test('M03-I review refuses recipient overlap and changed primary To',async()=>{
  for(const change of [{bcc_recipients:['alice@example.test']},
    {recipient_email:'wrong@example.test'}]){
    const h=fixture({draft:change});
    await assert.rejects(reviewProfessionalSendDraft(h.pool,'operator',request));
    assert.ok(h.state.queries.includes('ROLLBACK'));
  }
});
test('M03-I review validates exact IDs',()=>{
  assert.deepEqual(validateProfessionalReviewRequest(request),
    {draftId:id,revision:2});
  assert.throws(()=>validateProfessionalReviewRequest({...request,expected_revision:0}));
  assert.throws(()=>validateProfessionalReviewRequest({...request,draft_id:'wrong'}));
});
