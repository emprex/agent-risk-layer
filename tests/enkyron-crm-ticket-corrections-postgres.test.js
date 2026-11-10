import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {listCompanyTickets,ticketLinkedCompany,linkTicketToCompany,listLinkableTickets}
 from '../desktop/enkyron-crm-tickets.mjs';
import {listContactTickets,linkContactToTicket} from '../desktop/enkyron-crm-contact-tickets.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';
import {revokeTicketAssociation,listTicketRevocations}
 from '../desktop/enkyron-crm-ticket-corrections.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
 assert.equal(process.env.CI,'true');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('E02-05R reviewed revocation: remove effective links, preserve ALL immutable source rows',{
 skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-correct-'+randomUUID().slice(0,8);
 const rationale='Reviewed synthetic mismatch: original ticket belongs to another entity; only revoke mistaken association.';
 try{
  const company=await createCompany(pool,{name:'Synthetic Incorrect Holder'},actor);
  const other=await createCompany(pool,{name:'Synthetic Real Holder'},actor);
  const contact=await createContact(pool,{company_id:company.id,full_name:'Synthetic Contact'},actor);
  const ticketId=randomUUID(),legacyName='Synthetic historic customer';
  await pool.query(
   'INSERT INTO arl_workbench_tickets '
   +'(id,ticket_number,title,client_name,system_owner,target_kind,'
   +'target_reference,scope_text,assessor_name) '
   +"VALUES($1,$2,'Synthetic correction test',$3,'CI owner','other',"
   +"'manual:synthetic','CI review','CI')",
   [ticketId,'CI-RVK-'+ticketId,legacyName]);
  const linked=await linkTicketToCompany(pool,{
   company_id:company.id,ticket_id:ticketId,
   ticket_client_name_at_review:legacyName,
   review_note:rationale,reviewed:true
  },actor);
  await linkContactToTicket(pool,{
   company_id:company.id,contact_id:contact.id,ticket_id:ticketId,
   review_note:rationale,confirmed:true
  },actor);
  const source=(await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',
   [ticketId])).rows[0];
  const original=(await pool.query('SELECT * FROM enkyron_crm_ticket_links WHERE id=$1',
   [linked.id])).rows[0];
  const contactOriginal=(await pool.query(
   'SELECT * FROM enkyron_crm_contact_ticket_links WHERE ticket_id=$1',
   [ticketId])).rows[0];
  assert.equal((await listCompanyTickets(pool,company.id,actor)).items.length,1);
  assert.equal((await listContactTickets(pool,contact.id,actor)).items.length,1);
  await assert.rejects(()=>revokeTicketAssociation(pool,{
   company_id:other.id,ticket_id:ticketId,expected_client_name:legacyName,
   review_note:rationale,confirmed:true
  },actor),/not found/);
  await assert.rejects(()=>revokeTicketAssociation(pool,{
   company_id:company.id,ticket_id:ticketId,expected_client_name:'stale',
   review_note:rationale,confirmed:true
  },actor),/changed/);
  await assert.rejects(()=>revokeTicketAssociation(pool,{
   company_id:company.id,ticket_id:ticketId,expected_client_name:legacyName,
   review_note:rationale,confirmed:true
  },'different-actor'),/not found/);
  const result=await revokeTicketAssociation(pool,{
   company_id:company.id,ticket_id:ticketId,expected_client_name:legacyName,
   review_note:rationale,confirmed:true
  },actor);
  assert.equal(result.company_id,company.id);
  assert.equal((await listCompanyTickets(pool,company.id,actor)).items.length,0);
  assert.equal((await listContactTickets(pool,contact.id,actor)).items.length,0);
  assert.equal((await ticketLinkedCompany(pool,ticketId,actor)).link,null);
  assert.equal((await getCompanyDossier(pool,company.id,actor)).sections.tickets.total,0);
  assert.equal((await listLinkableTickets(pool,'CI-RVK-',actor)).items
   .some(x=>x.ticket_id===ticketId),false);
  await assert.rejects(()=>linkContactToTicket(pool,{
   company_id:company.id,contact_id:contact.id,ticket_id:ticketId,
   review_note:rationale,confirmed:true
  },actor),/not reviewed/);
  await assert.rejects(()=>linkTicketToCompany(pool,{
   company_id:other.id,ticket_id:ticketId,
   ticket_client_name_at_review:legacyName,review_note:rationale,reviewed:true
  },actor),/already linked/);
  const history=await listTicketRevocations(pool,company.id,actor);
  assert.equal(history.items.length,1);
  assert.equal(history.items[0].ticket_id,ticketId);
  assert.equal((await listTicketRevocations(pool,other.id,actor)).items.length,0);
  assert.ok(!JSON.stringify(history).includes(rationale));
  assert.ok(!JSON.stringify(history).includes(legacyName));
  const corrective=(await pool.query(
   "SELECT count(*)::int AS n FROM enkyron_crm_events "
   +"WHERE workspace_key=$1 AND resource_id=$2 AND event_type='corrected'",
   ['local:'+actor,company.id])).rows[0];
  assert.equal(corrective.n,1);
  await assert.rejects(()=>revokeTicketAssociation(pool,{
   company_id:company.id,ticket_id:ticketId,expected_client_name:legacyName,
   review_note:rationale,confirmed:true
  },actor),/already revoked/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_ticket_link_revocations WHERE ticket_id=$1',
   [ticketId]),/cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
   "UPDATE enkyron_crm_ticket_link_revocations SET revoked_by='other' WHERE ticket_id=$1",
   [ticketId]),/cannot be changed or deleted/);
  assert.deepEqual((await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',
   [ticketId])).rows[0],source);
  assert.deepEqual((await pool.query('SELECT * FROM enkyron_crm_ticket_links WHERE id=$1',
   [linked.id])).rows[0],original);
  assert.deepEqual((await pool.query(
   'SELECT * FROM enkyron_crm_contact_ticket_links WHERE ticket_id=$1',
   [ticketId])).rows[0],contactOriginal);
 }finally{await pool.end();}
});
