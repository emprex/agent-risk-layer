import test from 'node:test';
import assert from 'node:assert/strict';
import {
  professionalRecipientPayload,persistProfessionalRecipients,
  previousProfessionalRecipients,optionallyReadProfessionalRecipients
} from '../desktop/enkyron-mail-draft-recipient-storage.mjs';

const id='00000000-0000-4000-8000-000000000001';
const key='local:ci-only';
const fields={
  to_recipients:['FIRST@example.com','second@example.com'],
  cc_recipients:['manager@example.com'],
  bcc_recipients:['private@example.com']
};

test('M03-C legacy input stays on old path; aliases fail closed',()=>{
  assert.equal(professionalRecipientPayload({recipient_email:'x@example.com'}),null);
  assert.throws(()=>professionalRecipientPayload({...fields,to:[]}),/CRM M03/);
  assert.throws(()=>professionalRecipientPayload({to_recipients:fields.to_recipients}),/CRM M03/);
});

test('M03-C normalized, complete multi-recipient payload',()=>{
  const out=professionalRecipientPayload(fields);
  assert.deepEqual(out,{
    recipient_email:'first@example.com',
    to_recipients:['first@example.com','second@example.com'],
    cc_recipients:['manager@example.com'],
    bcc_recipients:['private@example.com']
  });
  assert.throws(()=>professionalRecipientPayload({
    ...fields,recipient_email:'else@example.com'
  }),/does not match/);
});

test('M03-C refuses BCC overlap and address injection',()=>{
  assert.throws(()=>professionalRecipientPayload({
    ...fields,bcc_recipients:['FIRST@example.com']
  }),/CRM M03/);
  assert.throws(()=>professionalRecipientPayload({
    ...fields,to_recipients:['ok@example.com\r\nBcc: bad@example.com']
  }),/CRM M03/);
});

test('M03-C writes all recipient arrays with scoped parameters, never sends',async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{queries.push({sql,params});return {rows:[{id}]};}};
  await persistProfessionalRecipients(db,key,id,professionalRecipientPayload(fields));
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/WHERE workspace_key=\$1 AND id=\$2 RETURNING id/);
  assert.deepEqual(queries[0].params.slice(0,2),[key,id]);
  assert.deepEqual(JSON.parse(queries[0].params[4]),['private@example.com']);
  assert.doesNotMatch(queries[0].sql,/Resend|send_attempts|SMTP|fetch\(/i);
});

test('M03-C rejects persistence if selected draft disappears',async()=>{
  await assert.rejects(()=>persistProfessionalRecipients({query:async()=>({rows:[]})},
    key,id,professionalRecipientPayload(fields)),/scope changed/);
});

test('M03-C locks existing draft recipients for revision-safe comparison',async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});return {rows:[fields]};
  }};
  assert.deepEqual(await previousProfessionalRecipients(db,key,id),fields);
  assert.match(queries[0].sql,/FOR UPDATE/);
  assert.deepEqual(queries[0].params,[key,id]);
});

test('M03-C does not require the real migration for legacy reads',async()=>{
  const queries=[];
  const db={query:async(sql)=>{queries.push(sql);return {rows:[{n:0}]};}};
  assert.equal(await optionallyReadProfessionalRecipients(db,key,id),null);
  assert.equal(queries.length,1);
});

test('M03-C detects incomplete migration and reads full migrated snapshot',async()=>{
  const incomplete={query:async()=>({rows:[{n:2}]})};
  await assert.rejects(()=>optionallyReadProfessionalRecipients(incomplete,key,id),/incomplete/);
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    return queries.length===1?{rows:[{n:3}]}:{rows:[fields]};
  }};
  assert.deepEqual(await optionallyReadProfessionalRecipients(db,key,id),fields);
  assert.deepEqual(queries[1].params,[key,id]);
});

import {assertLegacySingleRecipientSnapshot}
  from '../desktop/enkyron-mail-draft-recipient-storage.mjs';
test('M03-C legacy send rejects multi To, CC, BCC or primary mismatch',()=>{
  assert.doesNotThrow(()=>assertLegacySingleRecipientSnapshot('x@example.com',null));
  assert.doesNotThrow(()=>assertLegacySingleRecipientSnapshot('x@example.com',{
    to_recipients:['x@example.com'],cc_recipients:[],bcc_recipients:[]
  }));
  for(const recipientSnapshot of [
    {to_recipients:['x@example.com','z@example.com'],cc_recipients:[],bcc_recipients:[]},
    {to_recipients:['x@example.com'],cc_recipients:['c@example.com'],bcc_recipients:[]},
    {to_recipients:['x@example.com'],cc_recipients:[],bcc_recipients:['secret@example.com']},
    {to_recipients:['other@example.com'],cc_recipients:[],bcc_recipients:[]}
  ]){
    assert.throws(()=>assertLegacySingleRecipientSnapshot('x@example.com',recipientSnapshot),
      /no email sent/);
  }
});
