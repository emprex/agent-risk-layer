import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  createCompany,createContact,listCompanies,listContacts
} from '../desktop/enkyron-crm.mjs';

const url=process.env.ARL_CI_POSTGRES_URL || '';
function ephemeral(){
  assert.equal(process.env.CI,'true','Only ephemeral CI database is authorized');
  const value=new URL(url);
  assert.equal(value.hostname,'127.0.0.1');
  assert.equal(value.pathname,'/arl_ci');
  assert.equal(value.username,'arl_ci');
  assert.equal(value.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL CRM E02-01/02: distinct companies, scoped contacts, immutable audit, legacy untouched', {
  skip:!url && 'Dedicated disposable PostgreSQL service only',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:ephemeral(),max:2});
  try{
    const count=async table=>Number((await pool.query(
      'SELECT count(*)::int AS n FROM '+table
    )).rows[0].n);
    const before={
      prospects:await count('sales_prospects'),
      messages:await count('sales_messages'),
      tickets:await count('arl_workbench_tickets')
    };
    // Similar names do not silently collapse into one company.
    const first=await createCompany(pool,{
      name:'Synthetic Acme',city:'London',country:'UK',
      website:'https://example.invalid'
    },'ci-operator');
    const second=await createCompany(pool,{
      name:'Synthetic Acme',city:'Manchester'
    },'ci-operator');
    assert.notEqual(first.id,second.id);
    assert.equal(first.relationship_state,'prospect');
    const companies=await listCompanies(pool,'Synthetic Acme','ci-operator');
    assert.equal(companies.available,true);
    assert.ok(companies.items.some(x=>x.id===first.id));
    assert.ok(companies.items.some(x=>x.id===second.id));
    const other=await listCompanies(pool,'Synthetic Acme','ci-other');
    assert.ok(!other.items.some(x=>x.id===first.id));

    const contact=await createContact(pool,{
      company_id:first.id,full_name:'Synthetic Alice',
      job_title:'Engineering',email:'alice@example.invalid',phone:'000-000'
    },'ci-operator');
    assert.equal(contact.relationship_state,'unverified');
    assert.equal(contact.marketing_permission,'unknown');
    assert.equal((await listContacts(pool,first.id,'ci-operator')).items.length,1);
    assert.equal((await listContacts(pool,second.id,'ci-operator')).items.length,0);
    await assert.rejects(
      ()=>listContacts(pool,first.id,'ci-other'),
      /CRM company not found/
    );
    await assert.rejects(
      ()=>createContact(pool,{company_id:first.id,full_name:'Cross scope'},'ci-other'),
      /CRM company not found/
    );
    const events=(await pool.query(
      `SELECT resource_kind,event_type,actor_local FROM enkyron_crm_events
       WHERE resource_id=ANY($1::text[])`,[[first.id,second.id,contact.id]]
    )).rows;
    assert.equal(events.length,3);
    assert.ok(events.every(e=>e.event_type==='created'&&e.actor_local==='ci-operator'));
    const eventId=(await pool.query(
      'SELECT id FROM enkyron_crm_events WHERE resource_id=$1',[contact.id]
    )).rows[0].id;
    await assert.rejects(
      ()=>pool.query('DELETE FROM enkyron_crm_events WHERE id=$1',[eventId]),
      /cannot be changed or deleted/
    );
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_events WHERE id=$1',[eventId]
    )).rows[0].n,1);
    assert.deepEqual({
      prospects:await count('sales_prospects'),
      messages:await count('sales_messages'),
      tickets:await count('arl_workbench_tickets')
    },before);
  }finally{await pool.end();}
});
