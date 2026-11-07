import test from 'node:test';
import assert from 'node:assert/strict';
import {requireContactId,validateContactTicketLink,listContactTickets}
 from '../desktop/enkyron-crm-contact-tickets.mjs';
const company_id='11111111-2222-4333-8444-555555555555';
const contact_id='22222222-3333-4444-8555-666666666666';
const ticket_id='33333333-4444-4555-8666-777777777777';
const good={company_id,contact_id,ticket_id,review_note:
 'The company and ticket were reviewed before associating this contact.',confirmed:true};
test('review rejects forged IDs, no human confirmation and consent escalation',()=>{
 assert.equal(requireContactId(contact_id),contact_id);
 assert.equal(validateContactTicketLink(good).ticket_id,ticket_id);
 for(const bad of [{...good,contact_id:'x'}, {...good,ticket_id:'x'},
   {...good,company_id:'x'}, {...good,review_note:'short'},
   {...good,confirmed:false}, {...good,marketing_permission:'opt_in'},null,[]])
   assert.throws(()=>validateContactTicketLink(bad),/CRM|Invalid ticket/);
});
test('listing scopes contact identity and returns bounded history',async()=>{
 const queries=[];
 const pool={query:async(sql,params)=>{
  queries.push({sql,params});
  return {rows:sql.includes('FROM enkyron_crm_contacts')
   ?[{id:contact_id,company_id,full_name:'Synthetic'}]:[]};
 }};
 const x=await listContactTickets(pool,contact_id,'ci-local');
 assert.equal(x.available,true);
 assert.equal(x.items.length,0);
 assert.equal(queries[0].params[0],'local:ci-local');
 assert.match(queries[1].sql,/LIMIT 101/);
 const missing={query:async()=>{const e=new Error('missing');e.code='42P01';throw e;}};
 assert.equal((await listContactTickets(missing,contact_id,'ci-local')).available,false);
 await assert.rejects(()=>listContactTickets({query:async()=>({rows:[]})},contact_id,'ci-local'),/not found/);
});
