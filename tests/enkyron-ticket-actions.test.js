import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTicketAction,recordTicketAction,listTicketActions} from '../desktop/enkyron-ticket-actions.mjs';

const id='11111111-2222-4333-8444-555555555555';
const action='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const input={
  ticket_id:id,action_id:null,expected_revision:null,
  title:'Confirm exact scope and prerequisites',
  details:'Internal coordination item. No active testing.',
  due_on:'2026-12-01',state:'todo',
  rationale:'Operator manually planned this ticket action.',
  confirmed:true
};
test('E03-04A validates human action and rejects authority-like shortcuts',()=>{
  assert.equal(validateTicketAction(input).state,'todo');
  for(const bad of [
    {...input,confirmed:false},{...input,state:'done'},
    {...input,state:'approved'},{...input,due_on:'2026-02-30'},
    {...input,title:'x'}, {...input,action_id:action},
    {...input,expected_revision:1},{...input,details:'x\\u0000'.repeat(30)},
    {...input,rationale:'short'},{...input,unrecognised:true}
  ])assert.throws(()=>validateTicketAction(bad));
  assert.equal(validateTicketAction({...input,due_on:null}).due_on,null);
  assert.equal(validateTicketAction({
    ...input,action_id:action,expected_revision:3,state:'blocked'
  }).expected_revision,3);
});
test('E03-04A absent schema reports NOT AVAILABLE, not false success',async()=>{
  const missing={query:async()=>{const err=new Error('missing');err.code='42P01';throw err;}};
  const res=await listTicketActions(missing,id);
  assert.equal(res.available,false);
  assert.deepEqual(res.items,[]);
});
test('E03-04A rejects archived/closed ticket before new action write',async()=>{
  for(const status of ['closed','in_progress']){
    const statements=[];
    const client={
      query:async(sql)=>{
        statements.push(sql);
        if(sql.startsWith('SELECT status,archived_at')){
          return {rows:[{status,archived_at:status==='closed'?null:'2026-11-09'}]};
        }
        return {rows:[]};
      },
      release:()=>{}
    };
    await assert.rejects(()=>recordTicketAction({connect:async()=>client},input,
      'ci-operator'),/Closed or archived/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.ok(!statements.some(s=>s.startsWith('INSERT')));
  }
});
test('E03-04A stale action revision rolls back with no insertion',async()=>{
  const statements=[];
  const client={query:async(sql)=>{
    statements.push(sql);
    if(sql.startsWith('SELECT status,archived_at')){
      return {rows:[{status:'new',archived_at:null}]};
    }
    if(sql.startsWith('SELECT revision,title,details,due_on,state')){
      return {rows:[{revision:2,title:'Previous action',details:'',due_on:null,state:'todo'}]};
    }
    return {rows:[]};
  },release:()=>{}};
  await assert.rejects(()=>recordTicketAction({connect:async()=>client},{
    ...input,action_id:action,expected_revision:1
  },'ci-operator'),/changed/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some(s=>s.startsWith('INSERT')));
});
