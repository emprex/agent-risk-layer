import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany,listCompanyTickets,ticketLinkedCompany,listLinkableTickets}
 from '../desktop/enkyron-crm-tickets.mjs';
import {linkContactToTicket,listContactTickets} from '../desktop/enkyron-crm-contact-tickets.mjs';
import {revokeTicketAssociation} from '../desktop/enkyron-crm-ticket-corrections.mjs';
import {listReassignmentCandidates,reassignTicket} from '../desktop/enkyron-crm-ticket-reassignments.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';
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
test('E02-05S: one-time audited reassignment, scoped new contact, all historic rows intact',{
 skip:!url&&'Isolated PostgreSQL CI only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-transfer-'+randomUUID().slice(0,8);
 const legacyName='Synthetic original client text';
 const reason='Human reviewed synthetic company mismatch and approved this new target without moving old contacts.';
 try{
  const original=await createCompany(pool,{name:'Synthetic Wrong Company'},actor);
  const target=await createCompany(pool,{name:'Synthetic Target Company'},actor);
  const unrelated=await createCompany(pool,{name:'Synthetic Unrelated Company'},actor);
  const oldContact=await createContact(pool,{company_id:original.id,full_name:'Old Synthetic Person'},actor);
  const newContact=await createContact(pool,{company_id:target.id,full_name:'New Synthetic Person'},actor);
  const ticketId=randomUUID();
  await pool.query(
   'INSERT INTO arl_workbench_tickets '
   +'(id,ticket_number,title,client_name,system_owner,target_kind,target_reference,scope_text,assessor_name) '
   +"VALUES($1,$2,'Synthetic reassignment case',$3,'CI Owner','other','manual:synthetic','CI scope','CI')",
   [ticketId,'CI-TRANS-'+ticketId,legacyName]);
  await linkTicketToCompany(pool,{company_id:original.id,ticket_id:ticketId,
   ticket_client_name_at_review:legacyName,review_note:reason,reviewed:true},actor);
  await linkContactToTicket(pool,{company_id:original.id,contact_id:oldContact.id,
   ticket_id:ticketId,review_note:reason,confirmed:true},actor);
  const beforeTicket=(await pool.query(
   'SELECT * FROM arl_workbench_tickets WHERE id=$1',[ticketId])).rows[0];
  const originalLink=(await pool.query(
   'SELECT * FROM enkyron_crm_ticket_links WHERE ticket_id=$1',[ticketId])).rows[0];
  const historicalContact=(await pool.query(
   'SELECT * FROM enkyron_crm_contact_ticket_links WHERE ticket_id=$1',[ticketId])).rows[0];
  const revocation=await revokeTicketAssociation(pool,{company_id:original.id,
   ticket_id:ticketId,expected_client_name:legacyName,review_note:reason,
   confirmed:true},actor);
  assert.equal((await ticketLinkedCompany(pool,ticketId,actor)).link,null);
  const options=await listReassignmentCandidates(pool,target.id,'CI-TRANS-',actor);
  assert.equal(options.items.length,1);
  assert.equal(options.items[0].source_company_id,original.id);
  assert.equal(options.items[0].revocation_id,revocation.revocation_id);
  assert.equal((await listReassignmentCandidates(pool,original.id,'CI-TRANS-',actor))
   .items.length,0);
  const input={ticket_id:ticketId,destination_company_id:target.id,
    expected_source_company_id:original.id,
    expected_revocation_id:revocation.revocation_id,
    expected_client_name:legacyName,destination_record_version:1,
    review_note:reason,confirmed:true};
  await assert.rejects(()=>reassignTicket(pool,{...input,destination_company_id:unrelated.id},
   'wrong-operator'),/required|not found/i);
  await assert.rejects(()=>reassignTicket(pool,{...input,expected_revocation_id:randomUUID()},
   actor),/lineage changed/);
  await assert.rejects(()=>reassignTicket(pool,{...input,destination_record_version:2},
   actor),/revision changed/);
  const reassigned=await reassignTicket(pool,input,actor);
  assert.equal(reassigned.company_id,target.id);
  assert.equal((await listCompanyTickets(pool,original.id,actor)).items.length,0);
  assert.equal((await listCompanyTickets(pool,target.id,actor)).items.length,1);
  assert.equal((await ticketLinkedCompany(pool,ticketId,actor)).link.company_id,target.id);
  assert.equal((await getCompanyDossier(pool,target.id,actor)).sections.tickets.total,1);
  assert.equal((await getCompanyDossier(pool,original.id,actor)).sections.tickets.total,0);
  assert.equal((await listContactTickets(pool,oldContact.id,actor)).items.length,0);
  assert.equal((await listContactTickets(pool,newContact.id,actor)).items.length,0);
  await assert.rejects(()=>linkContactToTicket(pool,{company_id:original.id,
   contact_id:oldContact.id,ticket_id:ticketId,review_note:reason,confirmed:true},
   actor),/not reviewed/);
  await assert.rejects(()=>linkContactToTicket(pool,{company_id:target.id,
   contact_id:oldContact.id,ticket_id:ticketId,review_note:reason,confirmed:true},
   actor),/does not belong/);
  await linkContactToTicket(pool,{company_id:target.id,
   contact_id:newContact.id,ticket_id:ticketId,review_note:reason,confirmed:true},actor);
  assert.equal((await listContactTickets(pool,newContact.id,actor)).items.length,1);
  assert.equal((await listContactTickets(pool,oldContact.id,actor)).items.length,0);
  assert.equal((await listLinkableTickets(pool,'CI-TRANS-',actor)).items
   .some(t=>t.ticket_id===ticketId),false);
  assert.equal((await listReassignmentCandidates(pool,unrelated.id,'CI-TRANS-',actor))
   .items.length,0);
  await assert.rejects(()=>reassignTicket(pool,input,actor),/already reassigned/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_ticket_reassignments WHERE ticket_id=$1',[ticketId]),
   /cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_reassigned_contact_ticket_links WHERE ticket_id=$1',[ticketId]),
   /cannot be changed or deleted/);
  assert.deepEqual((await pool.query(
   'SELECT * FROM arl_workbench_tickets WHERE id=$1',[ticketId])).rows[0],beforeTicket);
  assert.deepEqual((await pool.query(
   'SELECT * FROM enkyron_crm_ticket_links WHERE ticket_id=$1',[ticketId])).rows[0],originalLink);
  assert.deepEqual((await pool.query(
   'SELECT * FROM enkyron_crm_contact_ticket_links WHERE ticket_id=$1',[ticketId])).rows[0],historicalContact);
 }finally{await pool.end();}
});
