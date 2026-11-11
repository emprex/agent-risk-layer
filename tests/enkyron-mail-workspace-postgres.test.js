import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  createMailDraft,readMailDraft,updateMailDraft,
} from '../desktop/enkyron-crm-mail-drafts.mjs';
import {
  mailAccess,mailStatus,mailSendDraft,mailSent,validateMailSendRequest,
} from '../desktop/enkyron-mail-service.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
test('email transport cannot accept unconfirmed, stale or malformed requests',()=>{
  for(const input of [{}, {draft_id:'wrong',confirmed:true,recipient_verified:true},
    {draft_id:crypto.randomUUID(),expected_revision:1,confirmed:false,recipient_verified:true},
    {draft_id:crypto.randomUUID(),expected_revision:1,confirmed:true,recipient_verified:false}])
    assert.throws(()=>validateMailSendRequest(input),/confirmation required/);
});
test('single local Mail workspace saves a standalone draft and sends once via mock Resend',{
  skip:!url&&'Disposable PostgreSQL CI only',timeout:60000,
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const actor='ci-mail-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+actor;
  const sent=[];
  const fakeKey='re_'+'A'.repeat(40);
  const credentialsLoader=async()=>({
    mailboxes:{
      direction:'11111111-1111-4111-8111-111111111111',
      support:'22222222-2222-4222-8222-222222222222'
    },
    credentialProvider:async()=>fakeKey,
  });
  const fetchImpl=async(url,init)=>{
    sent.push({url,init});
    return {ok:true,json:async()=>({id:crypto.randomUUID()})};
  };
  try{
    const access=await mailAccess(pool,actor);
    assert.equal(access.schema_ready,true);
    assert.equal(access.mailboxes.length,0);
    const created=await createMailDraft(pool,{
      mailbox_key:'support',recipient_email:'client@example.invalid',
      subject:'Review results',body_text:'Please review the proposed next steps.',
    },actor);
    assert.equal(created.mailbox_key,'support');
    const read=await readMailDraft(pool,created.id,actor);
    assert.equal(read.draft.mailbox_key,'support');
    await assert.rejects(mailSendDraft(pool,actor,{
      draft_id:created.id,expected_revision:1,recipient_verified:true,confirmed:true
    },{fetchImpl,credentialsLoader}),/send permission not granted/);
    assert.equal(sent.length,0);
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
      "VALUES($1,'support','organization_owner_l5',TRUE,TRUE,$2)",
      [scope,actor]
    );
    const grants=await mailAccess(pool,actor);
    assert.equal(grants.mailboxes[0].can_send,true);
    const outcome=await mailSendDraft(pool,actor,{
      draft_id:created.id,expected_revision:1,recipient_verified:true,confirmed:true
    },{fetchImpl,credentialsLoader});
    assert.equal(outcome.outcome,'accepted');
    assert.equal(sent.length,1);
    assert.equal(sent[0].url,'https://api.resend.com/emails');
    assert.equal(sent[0].init.method,'POST');
    assert.equal(sent[0].init.headers.Authorization,'Bearer '+fakeKey);
    assert.ok(sent[0].init.headers['Idempotency-Key']);
    const payload=JSON.parse(sent[0].init.body);
    assert.deepEqual(payload,{
      from:'support@agentrisklayer.com',
      to:['client@example.invalid'],
      subject:'Review results',
      text:'Please review the proposed next steps.'
    });
    const listed=await mailSent(pool,actor);
    assert.equal(listed.items.length,1);
    assert.equal(listed.items[0].outcome,'accepted');
    await assert.rejects(mailSendDraft(pool,actor,{
      draft_id:created.id,expected_revision:1,recipient_verified:true,confirmed:true
    },{fetchImpl,credentialsLoader}),/already submitted/);
    assert.equal(sent.length,1);
    await assert.rejects(updateMailDraft(pool,{
      id:created.id,expected_revision:1,
      recipient_email:'changed@example.invalid',
      subject:'Changed',body_text:'changed',
    },actor),/submitted to Resend/);
  }finally{await pool.end();}
});
test('provider timeout records uncertain outcome without automatic resend',{
  skip:!url&&'Disposable PostgreSQL CI only',timeout:60000,
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const actor='ci-uncertain-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+actor;let attempts=0;
  try{
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
      "VALUES($1,'direction','organization_owner_l5',TRUE,TRUE,$2)",
      [scope,actor]
    );
    const draft=await createMailDraft(pool,{
      mailbox_key:'direction',recipient_email:'client@example.invalid',
      subject:'Proposal',body_text:'Test message',
    },actor);
    const request={draft_id:draft.id,expected_revision:1,
      recipient_verified:true,confirmed:true};
    const params={
      credentialsLoader:async()=>({
        mailboxes:{direction:'11111111-1111-4111-8111-111111111111'},
        credentialProvider:async()=> 're_'+'A'.repeat(40)
      }),
      fetchImpl:async()=>{attempts++;throw Error('synthetic timeout');},
    };
    const result=await mailSendDraft(pool,actor,request,params);
    assert.equal(result.outcome,'uncertain');
    assert.equal(attempts,1);
    await assert.rejects(mailSendDraft(pool,actor,request,params),/already submitted/);
    assert.equal(attempts,1);
  }finally{await pool.end();}
});
