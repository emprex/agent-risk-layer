import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {listCompanyTickets,listLinkableTickets,ticketLinkedCompany,linkTicketToCompany}
  from '../desktop/enkyron-crm-tickets.mjs';

const database=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Not permitted outside disposable CI');
  const url=new URL(database);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.pathname,'/arl_ci');
  assert.equal(url.username,'arl_ci');
  assert.equal(url.password,'synthetic-ci-only');
  return database;
}
const explanation='Manually checked ticket identity and the intended CRM company; names may differ.';
test('PostgreSQL CRM-ticket association: source preservation, audit and deduplication', {
  skip:!database&&'Only disposable CI PostgreSQL',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const owner='ci-ticket-links',other='ci-other';
  try{
    const a=await createCompany(pool,{name:'Test customer identity A'},owner);
    const b=await createCompany(pool,{name:'Test customer identity B'},owner);
    const ticketId=randomUUID(),secondId=randomUUID(),thirdId=randomUUID();
    for(const [id,archived] of [[ticketId,false],[secondId,false],[thirdId,true]]){
      await pool.query(
        'INSERT INTO arl_workbench_tickets '
        +'(id,ticket_number,title,client_name,system_owner,target_kind,'
        +'target_reference,scope_text,assessor_name,archived_at) '
        +"VALUES ($1,$2,$3,'Historic customer label','Local synthetic operator',"
        +"'other','manual:test','Synthetic business request','ci-ticket-links',$4)",
        [id,'CI-'+id,'Synthetic CRM business request',archived?new Date():null]
      );
    }
    const source=(await pool.query(
      'SELECT * FROM arl_workbench_tickets WHERE id=$1',[ticketId]
    )).rows[0];
    const candidates=await listLinkableTickets(pool,'Historic customer',owner);
    assert.equal(candidates.available,true);
    assert.ok(candidates.items.some(x=>x.ticket_id===ticketId));
    assert.ok(!candidates.items.some(x=>x.ticket_id===thirdId));
    const link=await linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:ticketId,
      ticket_client_name_at_review:'Historic customer label',
      review_note:explanation,reviewed:true
    },owner);
    assert.equal(link.company_id,a.id);
    assert.deepEqual(
      (await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',[ticketId])).rows[0],
      source,'a CRM link must never rewrite the existing ticket'
    );
    const scoped=(await listCompanyTickets(pool,a.id,owner)).items;
    assert.equal(scoped.length,1);
    assert.equal(scoped[0].ticket_id,ticketId);
    assert.equal((await listCompanyTickets(pool,b.id,owner)).items.length,0);
    assert.equal((await ticketLinkedCompany(pool,ticketId,owner)).link.company_name,
      'Test customer identity A');
    assert.equal((await ticketLinkedCompany(pool,ticketId,other)).link,null);
    await assert.rejects(()=>listCompanyTickets(pool,a.id,other),/company not found/);
    const after=await listLinkableTickets(pool,'Historic customer',owner);
    assert.ok(!after.items.some(x=>x.ticket_id===ticketId));
    await assert.rejects(()=>linkTicketToCompany(pool,{
      company_id:b.id,ticket_id:ticketId,
      ticket_client_name_at_review:'Historic customer label',
      review_note:explanation,reviewed:true
    },owner),/already linked/);
    await assert.rejects(()=>linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:secondId,
      ticket_client_name_at_review:'Changed label',
      review_note:explanation,reviewed:true
    },owner),/client name changed/);
    await assert.rejects(()=>linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:thirdId,
      ticket_client_name_at_review:'Historic customer label',
      review_note:explanation,reviewed:true
    },owner),/archived ticket/);
    await assert.rejects(()=>linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:secondId,
      ticket_client_name_at_review:'Historic customer label',
      review_note:explanation,reviewed:true
    },other),/company not found/);
    const second=await linkTicketToCompany(pool,{
      company_id:a.id,ticket_id:secondId,
      ticket_client_name_at_review:'Historic customer label',
      review_note:explanation,reviewed:true
    },owner);
    assert.equal(second.company_id,a.id);
    assert.equal((await listCompanyTickets(pool,a.id,owner)).items.length,2);
    const event=(await pool.query(
      'SELECT event_type,resource_kind,actor_local FROM enkyron_crm_events '
      +"WHERE resource_id=$1 AND event_type='linked'",
      [a.id]
    )).rows;
    assert.equal(event.length,2);
    assert.ok(event.every(x=>x.actor_local===owner&&x.resource_kind==='company'));
    const linked=(await pool.query(
      'SELECT review_note,ticket_client_name_at_review FROM enkyron_crm_ticket_links '
      +'WHERE workspace_key=$1 AND ticket_id=$2',
      ['local:'+owner,ticketId]
    )).rows[0];
    assert.equal(linked.review_note,explanation);
    assert.equal(linked.ticket_client_name_at_review,'Historic customer label');
    await assert.rejects(
      ()=>pool.query(
        'DELETE FROM enkyron_crm_ticket_links WHERE workspace_key=$1 AND ticket_id=$2',
        ['local:'+owner,ticketId]
      ),/cannot be changed or deleted/
    );
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_ticket_links WHERE ticket_id=$1',
      [ticketId]
    )).rows[0].n,1);
  }finally{await pool.end();}
});
