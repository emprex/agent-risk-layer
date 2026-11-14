import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {linkMailTicket,listMailTicketLinks,listTicketMailLinks}
  from '../desktop/enkyron-mail-ticket-links.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Dedicated disposable GitHub Actions PostgreSQL only');
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}
const rationale='The operator reviewed the exact existing ticket and saved mail conversation and explicitly approved this reference.';
async function createSyntheticTicket(pool,client_name){
  const id=randomUUID();
  const ticket_number='CI-MAIL-'+id.slice(0,12);
  await pool.query(
    'INSERT INTO arl_workbench_tickets '+
    '(id,ticket_number,title,client_name,system_owner,target_kind,'+
    'target_reference,scope_text,assessor_name) '+
    "VALUES($1,$2,'CI synthetic existing service ticket',$3,'CI owner','other',"+
    "'synthetic:mail-link','Synthetic authority only','CI analyst')",
    [id,ticket_number,client_name]);
  return {id,ticket_number,client_name};
}
async function fixture(pool){
  const actor='ci-mailticket-'+randomUUID().slice(0,8),scope='local:'+actor;
  const foreign='ci-other-'+randomUUID().slice(0,8);
  const companyA=await createCompany(pool,{name:'Synthetic Client A '+actor},actor);
  const companyB=await createCompany(pool,{name:'Synthetic Client B '+actor},actor);
  const ticketA=await createSyntheticTicket(pool,'Synthetic Client A');
  const ticketB=await createSyntheticTicket(pool,'Synthetic Client B');
  const ticketUnlinked=await createSyntheticTicket(pool,'Unassociated client');
  for(const [company,ticket] of [[companyA,ticketA],[companyB,ticketB]]){
    await linkTicketToCompany(pool,{
      company_id:company.id,ticket_id:ticket.id,
      ticket_client_name_at_review:ticket.client_name,
      review_note:rationale,reviewed:true
    },actor);
  }
  await pool.query(
    'INSERT INTO enkyron_local_mail_access '+
    '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
    "VALUES($1,'direction','organization_owner_l5',true,false,$2),"+
    "($1,'support','organization_owner_l5',false,false,$2)",
    [scope,actor]);
  const threadA=randomUUID(),threadOther=randomUUID(),threadSpam=randomUUID();
  for(const [thread,folder,company] of [
    [threadA,'inbox',companyA.id],[threadOther,'inbox',null],[threadSpam,'spam',companyA.id]]){
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,folder_key,subject,crm_company_id) '+
      "VALUES($1,'direction',$2,$3,'Synthetic CI mail reference',$4)",
      [scope,thread,folder,company]);
  }
  const input=(ticket=ticketA,thread=threadA,mailbox='direction')=>({
    mailbox,thread_id:thread,ticket_id:ticket.id,
    ticket_number_at_review:ticket.ticket_number,
    client_name_at_review:ticket.client_name,
    review_note:rationale,confirmed:true
  });
  return {actor,scope,foreign,companyA,companyB,ticketA,ticketB,
    ticketUnlinked,threadA,threadOther,threadSpam,input};
}
test('Mail ↔ Ticket: real immutable PostgreSQL roundtrip and read isolation',{
  skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  try{
    const schema=(await pool.query(
      "SELECT to_regclass('public.enkyron_mail_ticket_links') AS linked"
    )).rows[0];
    assert.ok(schema.linked,'Migration 116 must be installed only on disposable CI DB');
    const f=await fixture(pool);
    const mailInput={mailbox:'direction',thread_id:f.threadA};
    const before=await listMailTicketLinks(pool,f.actor,mailInput);
    assert.equal(before.available,true);
    assert.equal(before.items.length,0);
    const linked=await linkMailTicket(pool,f.actor,f.input());
    assert.equal(linked.linked,true);
    assert.equal(linked.provider_unchanged,true);
    assert.equal(linked.ticket_unchanged,true);
    assert.equal(linked.ticket_id,f.ticketA.id);
    const mail=await listMailTicketLinks(pool,f.actor,mailInput);
    assert.equal(mail.items.length,1);
    assert.equal(mail.items[0].ticket_number,f.ticketA.ticket_number);
    assert.equal(mail.items[0].review_note,rationale);
    const ticket=await listTicketMailLinks(pool,f.actor,{ticket_id:f.ticketA.id});
    assert.equal(ticket.available,true);
    assert.equal(ticket.items.length,1);
    assert.equal(ticket.items[0].thread_id,f.threadA);
    assert.equal(ticket.items[0].subject,'Synthetic CI mail reference');
    assert.equal((await listMailTicketLinks(pool,f.foreign,mailInput)).available,false);
    assert.deepEqual((await listTicketMailLinks(pool,f.foreign,
      {ticket_id:f.ticketA.id})).items,[]);
    // Provider and the source ticket remain untouched, with no duplicate reference.
    await assert.rejects(linkMailTicket(pool,f.actor,f.input()),/already exists/);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1',[f.scope])).rows[0].n,1);
    for(const sql of [
      'UPDATE enkyron_mail_ticket_links SET linked_by=$2 WHERE workspace_key=$1',
      'DELETE FROM enkyron_mail_ticket_links WHERE workspace_key=$1'
    ])await assert.rejects(pool.query(sql,
      sql.startsWith('UPDATE')?[f.scope,'other']:[f.scope]),/immutable|read.only|cannot|denied/i);
    const preserved=(await pool.query(
      'SELECT review_note,linked_by FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1',[f.scope])).rows[0];
    assert.equal(preserved.review_note,rationale);
    assert.equal(preserved.linked_by,f.actor);
  }finally{await pool.end();}
});
test('Mail ↔ Ticket: real PostgreSQL refuses cross-company, mailbox, stale and archived links',{
  skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  try{
    const f=await fixture(pool);
    const failures=[
      [f.input(f.ticketB),/different reviewed CRM companies/],
      [f.input(f.ticketA,f.threadA,'support'),/permission not granted/],
      [{...f.input(),ticket_number_at_review:'CI-MAIL-STALE'},/identity changed/],
      [{...f.input(),client_name_at_review:'Wrong human-reviewed client'},/identity changed/],
      [f.input(f.ticketA,randomUUID()),/conversation not found/],
      [f.input(f.ticketA,f.threadSpam),/Spam\/Trash/],
      [f.input(f.ticketUnlinked),/reviewed CRM company|reviewed ticket company/i]
    ];
    for(const [input,reason] of failures){
      await assert.rejects(linkMailTicket(pool,f.actor,input),reason);
    }
    await pool.query('UPDATE arl_workbench_tickets SET archived_at=now() WHERE id=$1',
      [f.ticketA.id]);
    await assert.rejects(linkMailTicket(pool,f.actor,f.input()),/archived/);
    const count=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_ticket_links WHERE workspace_key=$1',
      [f.scope])).rows[0].n;
    assert.equal(count,0,'Refused operations must leave no Mail-ticket record');
    // Real composite FK: no phantom thread, and no cross-workspace aliasing.
    await assert.rejects(pool.query(
      'INSERT INTO enkyron_mail_ticket_links '+
      '(workspace_key,mailbox_key,thread_id,ticket_id,ticket_number_at_review,'+
      'client_name_at_review,review_note,linked_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [f.scope,'direction',randomUUID(),f.ticketB.id,
        f.ticketB.ticket_number,f.ticketB.client_name,rationale,f.actor]
    ),/foreign key/i);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_ticket_links WHERE workspace_key=$1',
      [f.scope])).rows[0].n,0);
  }finally{await pool.end();}
});