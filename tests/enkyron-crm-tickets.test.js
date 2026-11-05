import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTicketLink,listCompanyTickets,listLinkableTickets,
  ticketLinkedCompany,linkTicketToCompany
} from '../desktop/enkyron-crm-tickets.mjs';

const companyId='11111111-2222-4333-8444-555555555555';
const ticketId='22222222-3333-4444-8555-666666666666';
const input={company_id:companyId,ticket_id:ticketId,ticket_client_name_at_review:'Legacy Buyer',
  review_note:'Reviewed the historic ticket, customer identity and company scope.',
  reviewed:true};

test('validates operator-reviewed ticket association strictly',()=>{
  assert.equal(validateTicketLink(input).ticket_id,ticketId);
  for(const invalid of [
    {...input,company_id:'bad'}, {...input,ticket_id:'abc'},
    {...input,ticket_client_name_at_review:''},
    {...input,ticket_client_name_at_review:'Legacy\nBuyer'},
    {...input,review_note:'short'}, {...input,reviewed:false}, null, [], {}
  ]) assert.throws(()=>validateTicketLink(invalid),/CRM|Invalid ticket/);
});

test('candidate lookup is read-only and scoped by local operator',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[]};
  }};
  const list=await listLinkableTickets(pool,'  Legacy  ','ci-operator');
  assert.equal(list.available,true);
  assert.deepEqual(calls[0].params,['local:ci-operator','Legacy']);
  assert.match(calls[0].sql,/LIMIT 101/);
  assert.match(calls[0].sql,/archived_at IS NULL/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|MERGE)\s/i);
  await assert.rejects(()=>listLinkableTickets(pool,'x'.repeat(101),'ci-operator'),/100 characters/);
  const companyResult=await listCompanyTickets({
    query:async(sql)=>({rows:sql.includes('SELECT id,name')?
      [{id:companyId,name:'Example'}]:[{ticket_id:ticketId,title:'Test'}]})
  },companyId,'ci-operator');
  assert.equal(companyResult.items.length,1);
  const detail=await ticketLinkedCompany({
    query:async()=>({rows:[{company_id:companyId,company_name:'Example'}]})
  },ticketId,'ci-operator');
  assert.equal(detail.link.company_name,'Example');
});

test('missing association schema has explicit unavailable state',async()=>{
  const pool={query:async()=>{const e=new Error('missing');e.code='42P01';throw e;}};
  assert.equal((await listLinkableTickets(pool,'','ci-operator')).available,false);
  assert.equal((await listCompanyTickets(pool,companyId,'ci-operator')).available,false);
  assert.equal((await ticketLinkedCompany(pool,ticketId,'ci-operator')).available,false);
});

test('transaction commits only link and audit, rejects stale name and duplicates',async()=>{
  function simulation(flags={}){
    const calls=[];
    let released=false;
    const db={connect:async()=>({
      query:async(sql,values)=>{
        calls.push({sql,values});
        if(sql.includes('FROM enkyron_crm_companies'))return {rows:flags.crossWorkspace?[]:[
          {id:companyId,name:'Example Company'}]};
        if(sql.includes('FROM arl_workbench_tickets'))return {rows:flags.missingTicket?[]:[
          {id:ticketId,client_name:flags.stale?'Changed buyer':'Legacy Buyer',
           archived_at:flags.archived?'2026-11-05':null}]};
        if(sql.includes('FROM enkyron_crm_ticket_links'))return {rows:flags.already?
          [{company_id:companyId}]:[]};
        return {rows:[]};
      },
      release:()=>{released=true;}
    })};
    return {db,calls,released:()=>released};
  }
  for(const flags of [
    {crossWorkspace:true},{missingTicket:true},{stale:true},
    {archived:true},{already:true}
  ]){
    const sim=simulation(flags);
    await assert.rejects(()=>linkTicketToCompany(sim.db,input,'ci-operator'),
      /CRM/);
    assert.equal(sim.calls.at(-1).sql,'ROLLBACK');
    assert.equal(sim.released(),true);
    assert.ok(!sim.calls.some(x=>x.sql.startsWith('INSERT INTO ')));
  }
  const sim=simulation();
  const generated=['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
  const result=await linkTicketToCompany(sim.db,input,'ci-operator',{
    uuid:()=>generated.shift()
  });
  assert.equal(result.ticket_id,ticketId);
  assert.equal(result.company_id,companyId);
  assert.equal(sim.calls[0].sql,'BEGIN');
  assert.equal(sim.calls.at(-1).sql,'COMMIT');
  const link=sim.calls.find(x=>x.sql.startsWith('INSERT INTO enkyron_crm_ticket_links'));
  assert.deepEqual(link.values.slice(1,5),[
    'local:ci-operator',companyId,ticketId,'Legacy Buyer'
  ]);
  assert.ok(sim.calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_crm_events')));
  assert.equal(sim.released(),true);
});
