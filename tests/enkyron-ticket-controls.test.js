import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateControlReviewRequest,recordTicketControlApplicability}
  from '../desktop/enkyron-ticket-controls.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';

test('canonical control review refuses malformed ticket or out-of-register control',()=>{
  for(const bad of ['', 'ARL-KB-000','ARL-KB-109','ARL-KB-999','ARL-KB-1']) {
    assert.throws(()=>validateControlReviewRequest({
      ticket_id:ticket,control_id:bad
    }),/Control review/);
  }
  assert.throws(()=>validateControlReviewRequest({
    ticket_id:'other',control_id:'ARL-KB-001'
  }),/Control review/);
  assert.deepEqual(validateControlReviewRequest({
    ticket_id:ticket,control_id:'ARL-KB-108'
  }),{ticketId:ticket,controlId:'ARL-KB-108'});
});

test('no human applicability write without exact snapshot, digest, facts and confirmation',()=>{
  const valid={
    ticket_id:ticket,control_id:'ARL-KB-001',
    decision:'applicable',reason:'Human confirmed control applies to frozen agent scope.',
    snapshot_id:'sys_a1ea05c78ee64357a4c8a75b47ce4662',
    evaluation_digest:'a'.repeat(64),
    architecture_fact_ids:[],confirmed:true
  };
  assert.deepEqual(validateControlReviewRequest(valid,{decision:true}),
    {ticketId:ticket,controlId:'ARL-KB-001'});
  for(const change of [
    {confirmed:false},{decision:'passed'},{reason:'short'},
    {snapshot_id:'sys_wrong'}, {evaluation_digest:'ab'},
    {architecture_fact_ids:null},
    {decision:'not_applicable'},
    {decision:'context_required',confirmed:null},
  ]){
    assert.throws(()=>validateControlReviewRequest({...valid,...change},{decision:true}),
      /Control review/);
  }
});

test('malformed decision never touches database, even if invoked directly',async()=>{
  const pool={query:()=>{throw new Error('Unexpected database access');}};
  await assert.rejects(recordTicketControlApplicability(pool,{
    ticket_id:ticket,control_id:'ARL-KB-001',decision:'applicable',
    reason:'human decision not yet confirmed',
    snapshot_id:'sys_a1ea05c78ee64357a4c8a75b47ce4662',
    evaluation_digest:'a'.repeat(64),architecture_fact_ids:[],confirmed:false
  },'emprex'),/Control review/);
});
