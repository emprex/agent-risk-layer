import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTicketReassignment,validateReassignmentLookup,listReassignmentCandidates,reassignTicket}
 from '../desktop/enkyron-crm-ticket-reassignments.mjs';
const source='11111111-2222-4333-8444-555555555555';
const target='22222222-3333-4444-8555-666666666666';
const ticket='33333333-4444-4555-8666-777777777777';
const revocation='44444444-5555-4666-8777-888888888888';
const input={ticket_id:ticket,destination_company_id:target,
 expected_source_company_id:source,expected_revocation_id:revocation,
 expected_client_name:'Synthetic historic customer',destination_record_version:1,
 review_note:'Verified the original synthetic association is wrong, and confirmed this new destination.',confirmed:true};
test('strict reassignment input fails closed on unauthorized or stale fields',()=>{
 assert.equal(validateTicketReassignment(input).ticket_id,ticket);
 assert.equal(validateReassignmentLookup({destination_company_id:target,search:''}).search,'');
 for(const bad of [{...input,ticket_id:'invalid'}, {...input,confirmed:false},
  {...input,expected_revocation_id:'invalid'}, {...input,expected_source_company_id:target},
  {...input,destination_record_version:0}, {...input,review_note:'short'},
  {...input,review_note:'bad\nnote'}, {...input,move_contacts:true},
  {...input,expected_client_name:'bad\nname'},null,[]]){
  assert.throws(()=>validateTicketReassignment(bad));
 }
 assert.throws(()=>validateReassignmentLookup({destination_company_id:target,secret:'x'}),/CRM/);
});
function fake({missingRevocation=false,stale=false,missingTarget=false,version=1,exists=false,archived=false}={}){
 const calls=[];
 const c={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('FROM enkyron_crm_ticket_link_revocations rv'))
   return {rows:missingRevocation?[]:[{id:revocation,company_id:source,
      ticket_id:ticket,client_name:stale?'changed':input.expected_client_name,
      archived_at:archived?'2026-01-01':null}]};
  if(sql.includes('SELECT id,record_version FROM enkyron_crm_companies'))
   return {rows:missingTarget?[]:[{id:target,record_version:version}]};
  if(sql.includes('SELECT id FROM enkyron_crm_ticket_reassignments'))
   return {rows:exists?[{id:revocation}]:[]};
  if(sql.startsWith('SELECT id,name,record_version FROM enkyron_crm_companies'))
   return {rows:missingTarget?[]:[{id:target,record_version:1,name:'Synthetic'}]};
  return {rows:[]};
 },release(){}};
 return {db:{connect:async()=>c,query:c.query},calls};
}
test('atomic transaction creates immutable reassignment and event, never changes old records',async()=>{
 const x=fake();
 const res=await reassignTicket(x.db,input,'synthetic',{uuid:()=>revocation});
 assert.equal(res.company_id,target);
 assert.equal(res.source_company_id,source);
 assert.equal(x.calls[0].sql,'BEGIN');
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.ok(x.calls.some(x=>x.sql.includes('pg_advisory_xact_lock')));
 assert.deepEqual(x.calls[2].args,['local:synthetic',ticket]);
 assert.equal(x.calls.filter(c=>c.sql.startsWith('INSERT')).length,2);
 assert.ok(!x.calls.some(c=>/^(DELETE|UPDATE)/.test(c.sql)));
});
test('missing, changed, archived, already assigned and stale target all rollback',async()=>{
 for(const options of [{missingRevocation:true},{stale:true},{missingTarget:true},
  {version:2},{exists:true},{archived:true}]){
  const x=fake(options);
  await assert.rejects(()=>reassignTicket(x.db,input,'synthetic'));
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.equal(x.calls.some(c=>c.sql.startsWith('INSERT')),false);
 }
});
test('candidate listing stays destination/workspace scoped',async()=>{
 const x=fake();
 const res=await listReassignmentCandidates(x.db,target,'synthetic','synthetic');
 assert.equal(res.company.id,target);
 assert.equal(x.calls[0].args[0],'local:synthetic');
 assert.deepEqual(x.calls[1].args,['local:synthetic',target,'synthetic']);
 assert.match(x.calls[1].sql,/LIMIT 101/);
 assert.match(x.calls[1].sql,/NOT EXISTS/);
});
