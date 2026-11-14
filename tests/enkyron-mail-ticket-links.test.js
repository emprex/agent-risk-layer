import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMailTicketLink,linkMailTicket,listMailTicketLinks,listTicketMailLinks}
 from '../desktop/enkyron-mail-ticket-links.mjs';
const mailbox='direction',thread_id='11111111-2222-4333-8444-555555555555';
const ticket_id='22222222-3333-4444-8555-666666666666';
const good={mailbox,thread_id,ticket_id,ticket_number_at_review:'ARL-2026-000003',
  client_name_at_review:'Reviewed client',review_note:'Human verified this specific conversation and existing ticket.',confirmed:true};
test('manual Mail-ticket association requires exact identities and approval',()=>{
  assert.deepEqual(validateMailTicketLink(good),good);
  for(const bad of [
    {...good,confirmed:false},{...good,mailbox:'all'},
    {...good,thread_id:'invalid'},{...good,ticket_id:'invalid'},
    {...good,ticket_number_at_review:'x'},{...good,client_name_at_review:''},
    {...good,review_note:'Too short'},{...good,review_note:'bad\0note'}
  ])assert.throws(()=>validateMailTicketLink(bad));
});
test('readback never reports missing migration as empty success',async()=>{
  const db={query:async()=>{let e=Error('missing');e.code='42P01';throw e;}};
  const a=await listMailTicketLinks(db,'emprex',{mailbox,thread_id});
  const b=await listTicketMailLinks(db,'emprex',{ticket_id});
  assert.equal(a.available,false);assert.equal(b.available,false);
  assert.match(a.notice,/schema 116/);
});
function fixture({company=null,linkCompany=null,archived=false,duplicate=false,can_read=true}={}){
  const calls=[],tx=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('BEGIN')||sql.startsWith('COMMIT')||sql.startsWith('ROLLBACK')){
      tx.push(sql);return {rows:[]};
    }
    if(sql.includes('SELECT can_read'))return {rows:[{can_read}]};
    if(sql.includes('SELECT crm_company_id,folder_key'))return {rows:[{crm_company_id:company,folder_key:'inbox'}]};
    if(sql.includes('SELECT id,ticket_number,title,client_name,archived_at'))
      return {rows:[{id:ticket_id,ticket_number:good.ticket_number_at_review,
        client_name:good.client_name_at_review,archived_at:archived?'2026-11-14':null}]};
    if(sql.includes('SELECT company_id FROM enkyron_crm_effective_ticket_links'))
      return {rows:linkCompany?[{company_id:linkCompany}]:[]};
    if(sql.includes('INSERT INTO enkyron_mail_ticket_links'))
      return {rows:duplicate?[]:[{ticket_id}],rowCount:duplicate?0:1};
    return {rows:[]};
  },release:()=>{tx.push('RELEASE');}};
  return {pool:{connect:async()=>db},calls,tx};
}
test('link is transactional, scoped, append-only and has no provider action',async()=>{
  const f=fixture();
  const out=await linkMailTicket(f.pool,'emprex',good);
  assert.equal(out.linked,true);
  assert.deepEqual(f.tx,['BEGIN','COMMIT','RELEASE']);
  const insert=f.calls.find(x=>x.sql.includes('INSERT INTO enkyron_mail_ticket_links'));
  assert.deepEqual(insert.params.slice(0,4),['local:emprex',mailbox,thread_id,ticket_id]);
  assert.ok(f.calls.every(x=>!/resend|send-draft/i.test(x.sql) && !/^\s*(?:DELETE|UPDATE)\b/i.test(x.sql)));
});
test('mail-ticket link rejects stale identity, wrong company, missing permission and duplicates',async()=>{
  const cases=[
    {good:{...good,client_name_at_review:'Wrong client'},opts:{}},
    {good,opts:{company:'33333333-4444-4555-8666-777777777777',
      linkCompany:'44444444-5555-4666-8777-888888888888'}},
    {good,opts:{can_read:false}},
    {good,opts:{duplicate:true}},
    {good,opts:{archived:true}}
  ];
  for(const {good:payload,opts} of cases){
    const f=fixture(opts);
    await assert.rejects(()=>linkMailTicket(f.pool,'emprex',payload));
    assert.deepEqual(f.tx,['BEGIN','ROLLBACK','RELEASE']);
  }
});
test('bidirectional reads are restricted to operator and mailbox access',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT can_read'))return {rows:[{can_read:true}]};
    return {rows:[{ticket_id,ticket_number:'ARL-2026-000003',
      thread_id,mailbox_key:mailbox}]};
  }};
  let a=await listMailTicketLinks(db,'emprex',{mailbox,thread_id});
  let b=await listTicketMailLinks(db,'emprex',{ticket_id});
  assert.equal(a.available,true);assert.equal(b.available,true);
  assert.deepEqual(calls[1].params,['local:emprex',mailbox,thread_id]);
  assert.deepEqual(calls[2].params,['local:emprex',ticket_id]);
  assert.match(calls[2].sql,/a\.can_read=true/);
});
