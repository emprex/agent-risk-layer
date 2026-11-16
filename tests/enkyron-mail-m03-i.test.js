
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mailSendDraft,
  validateMailSendRequest
} from '../desktop/enkyron-mail-service.mjs';

import {
  prepareProfessionalMailPayload,
  professionalPayloadFingerprint
} from '../desktop/enkyron-mail-professional-payload.mjs';

const draftId='11111111-1111-4111-8111-111111111111';
const providerId='22222222-2222-4222-8222-222222222222';

const base={
  id:draftId,
  revision:4,
  mailbox_key:'direction',
  recipient_email:'alice@example.test',
  to_recipients:[
    'alice@example.test',
    'bob@example.test'
  ],
  cc_recipients:['carol@example.test'],
  bcc_recipients:['private@example.test'],
  subject:'Synthetic professional mail',
  body_text:'This is an offline M03-I test.'
};

const confirmation=professionalPayloadFingerprint(
  prepareProfessionalMailPayload(base)
);

function harness(changes={}){
  const draft={...base,...changes};
  const state={
    posts:[],
    attempts:0,
    prior:false,
    granted:true
  };

  const client={
    async query(sql,args=[]){
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))
        return {rows:[]};

      if(sql.includes('SELECT d.id,d.revision,d.mailbox_key')){
        return {rows:args[0]==='local:operator'?[draft]:[]};
      }

      if(sql.includes('SELECT can_send FROM'))
        return {rows:[{can_send:state.granted}]};

      if(sql.includes('SELECT id FROM enkyron_mail_send_attempts'))
        return {rows:state.prior?[{id:'existing'}]:[]};

      if(sql.includes('SELECT id FROM enkyron_crm_mail_manual_sends'))
        return {rows:[]};

      if(sql.includes(
        'SELECT to_recipients,cc_recipients,bcc_recipients'
      ))
        return {rows:[draft]};

      if(sql.includes('INSERT INTO enkyron_mail_send_attempts')){
        state.attempts++;
        state.prior=true;
        return {rows:[]};
      }

      throw Error('Unexpected synthetic SQL: '+sql);
    },
    release(){}
  };

  const pool={
    async connect(){return client;},
    async query(sql){
      if(sql.startsWith('UPDATE enkyron_mail_send_attempts'))
        return {rows:[]};
      throw Error('Unexpected pool SQL: '+sql);
    }
  };

  const options={
    credentialsLoader:async()=>({
      mailboxes:{
        direction:'33333333-3333-4333-8333-333333333333'
      },
      credentialProvider:async()=>'synthetic-token'
    }),
    fetchImpl:async(url,request)=>{
      state.posts.push({url,request});
      return {
        ok:true,
        json:async()=>({id:providerId})
      };
    }
  };

  const input={
    draft_id:draftId,
    expected_revision:4,
    recipient_verified:true,
    confirmed:true,
    confirmation_sha256:confirmation
  };

  return {pool,options,input,state,draft};
}

test('M03-I preserves the legacy confirmation contract',()=>{
  const input={
    draft_id:draftId,
    expected_revision:4,
    recipient_verified:true,
    confirmed:true
  };

  assert.deepEqual(validateMailSendRequest(input),{
    draftId,
    revision:4
  });
});

test('M03-I sends To CC BCC separately using a synthetic provider',async()=>{
  const h=harness();

  const result=await mailSendDraft(
    h.pool,'operator',h.input,h.options
  );

  assert.equal(result.outcome,'accepted');
  assert.equal(h.state.attempts,1);
  assert.equal(h.state.posts.length,1);

  const posted=h.state.posts[0];
  const body=JSON.parse(posted.request.body);

  assert.deepEqual(body.to,base.to_recipients);
  assert.deepEqual(body.cc,base.cc_recipients);
  assert.deepEqual(body.bcc,base.bcc_recipients);
  assert.equal(body.text,base.body_text);

  assert.equal(
    posted.url,
    'https://api.resend.com/emails'
  );

  assert.ok(!body.to.includes('private@example.test'));
  assert.ok(!body.cc.includes('private@example.test'));

  await assert.rejects(
    mailSendDraft(h.pool,'operator',h.input,h.options),
    /already submitted/i
  );

  assert.equal(h.state.posts.length,1);
});

test('M03-I refuses changed recipient groups',async()=>{
  const h=harness({
    cc_recipients:['changed@example.test']
  });

  await assert.rejects(
    mailSendDraft(h.pool,'operator',h.input,h.options),
    /review again/i
  );

  assert.equal(h.state.attempts,0);
  assert.equal(h.state.posts.length,0);
});

test('M03-I refuses stale PostgreSQL revisions',async()=>{
  const h=harness({revision:5});

  await assert.rejects(
    mailSendDraft(h.pool,'operator',h.input,h.options),
    /revision changed/i
  );

  assert.equal(h.state.attempts,0);
  assert.equal(h.state.posts.length,0);
});

test('M03-I refuses BCC overlaps',async()=>{
  const h=harness({
    cc_recipients:['private@example.test']
  });

  await assert.rejects(
    mailSendDraft(h.pool,'operator',h.input,h.options)
  );

  assert.equal(h.state.attempts,0);
  assert.equal(h.state.posts.length,0);
});

test('M03-I refuses missing send permissions',async()=>{
  const h=harness();
  h.state.granted=false;

  await assert.rejects(
    mailSendDraft(h.pool,'operator',h.input,h.options),
    /permission/i
  );

  assert.equal(h.state.attempts,0);
  assert.equal(h.state.posts.length,0);
});

test('M03-I refuses another operator workspace',async()=>{
  const h=harness();

  await assert.rejects(
    mailSendDraft(h.pool,'another_operator',h.input,h.options)
  );

  assert.equal(h.state.attempts,0);
  assert.equal(h.state.posts.length,0);
});

test('M03-I treats provider timeout as uncertain, without retry',async()=>{
  const h=harness();

  h.options.fetchImpl=async(url,request)=>{
    h.state.posts.push({url,request});
    throw Error('Synthetic timeout');
  };

  const result=await mailSendDraft(
    h.pool,'operator',h.input,h.options
  );

  assert.equal(result.outcome,'uncertain');
  assert.equal(h.state.attempts,1);
  assert.equal(h.state.posts.length,1);
});
