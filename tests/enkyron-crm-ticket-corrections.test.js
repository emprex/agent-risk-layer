import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTicketRevocation,revokeTicketAssociation,listTicketRevocations}
 from '../desktop/enkyron-crm-ticket-corrections.mjs';
const company_id='11111111-2222-4333-8444-555555555555';
const ticket_id='22222222-3333-4444-8555-666666666666';
const link_id='33333333-4444-4555-8666-777777777777';
const good={company_id,ticket_id,expected_client_name:'Synthetic historical name',
 review_note:'Human reviewed a wrong synthetic CRM association; revoke without source deletion.',
 confirmed:true};
test('revocation requires exact identifiers, current client label and human rationale',()=>{
 assert.equal(validateTicketRevocation(good).ticket_id,ticket_id);
 for(const invalid of [{...good,company_id:'not-uuid'}, {...good,ticket_id:'not-uuid'},
  {...good,expected_client_name:'bad\nname'},{...good,review_note:'short'},
  {...good,review_note:'bad\0note'}, {...good,confirmed:false},
  {...good,reassign_company_id:company_id},null,[]]){
  assert.throws(()=>validateTicketRevocation(invalid),/CRM|Invalid ticket identifier/);
 }
});
function mock({missing=false,wrongName=false,revoked=false}={}){
 const queries=[],client={
  async query(sql,args){
   queries.push({sql,args});
   if(sql.includes('FROM enkyron_crm_ticket_links l'))
    return {rows:missing?[]:[{id:link_id,company_id,ticket_id,
     client_name:wrongName?'changed':good.expected_client_name}]};
   if(sql.includes('SELECT id FROM enkyron_crm_ticket_link_revocations'))
    return {rows:revoked?[{id:link_id}]:[]};
   return {rows:[]};
  },
  release(){}
 };
 return {pool:{connect:async()=>client},queries};
}
test('correction uses single atomic append-only transaction and operator workspace',async()=>{
 const x=mock();
 const result=await revokeTicketAssociation(x.pool,good,'synthetic',{uuid:()=>link_id});
 assert.equal(result.ticket_id,ticket_id);
 assert.equal(x.queries[0].sql,'BEGIN');
 assert.equal(x.queries.at(-1).sql,'COMMIT');
 assert.deepEqual(x.queries[1].args,['local:synthetic',company_id,ticket_id]);
 assert.equal(x.queries.filter(q=>q.sql.startsWith('INSERT')).length,2);
 assert.ok(x.queries.some(q=>q.sql.includes("'corrected'")));
 assert.ok(!x.queries.some(q=>/^(DELETE|UPDATE)/.test(q.sql)));
});
test('not-owned, stale and already revoked links fail without writing',async()=>{
 for(const opts of [{missing:true},{wrongName:true},{revoked:true}]){
  const x=mock(opts);
  await assert.rejects(()=>revokeTicketAssociation(x.pool,good,'synthetic'),/not found|changed|already revoked/);
  assert.equal(x.queries.at(-1).sql,'ROLLBACK');
  assert.ok(!x.queries.some(q=>q.sql.startsWith('INSERT')));
 }
});
test('history SQL never selects rationale or customer personal fields',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.startsWith('SELECT id FROM enkyron_crm_companies')
   ?[{id:company_id}]:[]};
 }};
 const result=await listTicketRevocations(pool,company_id,'synthetic');
 assert.equal(result.available,true);
 assert.deepEqual(calls[0].args,['local:synthetic',company_id]);
 assert.deepEqual(calls[1].args,['local:synthetic',company_id]);
 assert.doesNotMatch(calls[1].sql,/review_note|client_name|full_name|email|phone/);
 assert.match(calls[1].sql,/LIMIT 51/);
});
