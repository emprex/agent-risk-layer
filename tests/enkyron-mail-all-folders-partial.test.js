import test from 'node:test';
import assert from 'node:assert/strict';
import {combineMailboxPages} from '../desktop/enkyron-mail-service.mjs';

const direction={mailbox:'direction',folder:'trash',items:[
  {id:'11111111-1111-4111-8111-111111111111',mailbox:'direction',
    subject:'Customer inquiry',last_message_at:'2026-11-11T10:00:00Z'}],has_more:false};
const support={mailbox:'support',folder:'trash',items:[
  {id:'22222222-2222-4222-8222-222222222222',mailbox:'support',
    subject:'Support inquiry',last_message_at:'2026-11-10T10:00:00Z'}],has_more:true};
const good=value=>({status:'fulfilled',value});
const failed=()=>({status:'rejected',reason:Error('Synthetic provider error')});

test('All mail keeps healthy Trash results when the other account fails',()=>{
  const result=combineMailboxPages('trash',[good(direction),failed()]);
  assert.equal(result.mailbox,'all');
  assert.equal(result.folder,'trash');
  assert.equal(result.partial,true);
  assert.deepEqual(result.unavailable_mailboxes,['support']);
  assert.deepEqual(result.items.map(x=>x.subject),['Customer inquiry']);
  assert.equal(result.has_more,false);
  assert.ok(!JSON.stringify(result).includes('Synthetic provider error'));
});

test('An empty healthy mailbox plus failed second account is NOT a verified empty Inbox',()=>{
  const result=combineMailboxPages('inbox',[failed(),good({...support,items:[],has_more:false})]);
  assert.equal(result.items.length,0);
  assert.equal(result.partial,true);
  assert.deepEqual(result.unavailable_mailboxes,['direction']);
});

test('Two failed accounts never create a false empty folder',()=>{
  assert.throws(()=>combineMailboxPages('trash',[failed(),failed()]),
    /Both mail accounts are unavailable/);
});

test('Successful mailbox pages are sorted and preserve pagination',()=>{
  const result=combineMailboxPages('trash',[good(direction),good(support)]);
  assert.equal(result.partial,false);
  assert.deepEqual(result.unavailable_mailboxes,[]);
  assert.deepEqual(result.items.map(x=>x.subject),['Customer inquiry','Support inquiry']);
  assert.equal(result.has_more,true);
  assert.throws(()=>combineMailboxPages('../trash',[good(direction),good(support)]),
    /Invalid mailbox page combination/);
});
