import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {linkContactToTicket,listContactTickets} from '../desktop/enkyron-crm-contact-tickets.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
 assert.equal(process.env.CI,'true');
 const x=new URL(url);
 assert.equal(x.hostname,'127.0.0.1');
 assert.equal(x.pathname,'/arl_ci');
 assert.equal(x.username,'arl_ci');
 assert.equal(x.password,'synthetic-ci-only');
 return url;
}
test('E02-05 reviewed many-to-many contact/ticket links, foreign keys and immutable history',{
 skip:!url&&'CI synthetic database required',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3}),actor='ci-many-links';
 const reason='The company, ticket and contact were checked manually before association.';
 try{
  const a=await createCompany(pool,{name:'Synthetic Customer A'},actor);
  const b=await createCompany(pool,{name:'Synthetic Customer B'},actor);
  const c1=await createContact(pool,{company_id:a.id,full_name:'Synthetic First'},actor);
  const c2=await createContact(pool,{company_id:a.id,full_name:'Synthetic Second'},actor);
  const c3=await createContact(pool,{company_id:b.id,full_name:'Synthetic Outside'},actor);
  const tickets=[randomUUID(),randomUUID()];
  for(const id of tickets){
   await pool.query('INSERT INTO arl_workbench_tickets '
    +'(id,ticket_number,title,client_name,system_owner,target_kind,'
    +'target_reference,scope_text,assessor_name) VALUES '
    +"($1,$2,'Synthetic case','Old label','Synthetic owner','other',"
    +"'manual:synthetic','Synthetic request','ci-many-links')",
    [id,'CI-LINK-'+id]);
   await linkTicketToCompany(pool,{company_id:a.id,ticket_id:id,
    ticket_client_name_at_review:'Old label',review_note:reason,reviewed:true},actor);
  }
  const data=(contact_id,ticket_id)=>({company_id:a.id,contact_id,ticket_id,
   review_note:reason,confirmed:true});
  await linkContactToTicket(pool,data(c1.id,tickets[0]),actor);
  await linkContactToTicket(pool,data(c1.id,tickets[1]),actor);
  await linkContactToTicket(pool,data(c2.id,tickets[0]),actor);
  assert.equal((await listContactTickets(pool,c1.id,actor)).items.length,2);
  assert.equal((await listContactTickets(pool,c2.id,actor)).items.length,1);
  await assert.rejects(()=>linkContactToTicket(pool,data(c1.id,tickets[0]),actor),/already linked/);
  await assert.rejects(()=>linkContactToTicket(pool,data(c3.id,tickets[0]),actor),/does not belong/);
  await assert.rejects(()=>linkContactToTicket(pool,data(c1.id,tickets[0]),'other-local'),/not found/);
  await assert.rejects(()=>listContactTickets(pool,c1.id,'other-local'),/not found/);
  const source=(await pool.query('SELECT relationship_state,marketing_permission '
   +'FROM enkyron_crm_contacts WHERE id=$1',[c1.id])).rows[0];
  assert.deepEqual(source,{relationship_state:'unverified',marketing_permission:'unknown'});
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_contact_ticket_links WHERE contact_id=$1',[c1.id]),
   /cannot be changed or deleted/);
  const linked=(await pool.query('SELECT count(*)::int AS n FROM enkyron_crm_events '
   +"WHERE resource_kind='contact' AND event_type='linked' AND resource_id=$1",
   [c1.id])).rows[0];
  assert.equal(linked.n,2);
 }finally{await pool.end();}
});
