import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReviewedMailFiling,fileReviewedMailDossier}
  from '../desktop/enkyron-mail-reviewed-dossier.mjs';

const C='11111111-2222-4333-8444-555555555555';
const T='22222222-3333-4444-8555-666666666666';
const R='33333333-4444-4555-8666-777777777777';
const M='44444444-5555-4666-8777-888888888888';
const A='55555555-6666-4777-8888-999999999999';
const SHA='a'.repeat(64);
const req={mailbox:'direction',thread_id:R,company_id:C,
  company_name_at_review:'Synthetic Louvain',
  ticket_id:T,ticket_number_at_review:'CI-001',
  client_name_at_review:'Louvain Engine',
  message_id:M,attachment_id:A,filename_at_review:'synthetic.pdf',
  review_note:'Synthetic reviewed mail, company, ticket and attachment.',
  confirmed:true};

function fixture(options={}){
  const saved={tickets:new Set(),documents:new Set()};
  const calls=[];
  let tx=null,commits=0,rollbacks=0;
  const rows=items=>({rows:items});
  const db={
    async query(sql,p=[]){
      calls.push({sql,p});
      if(sql==='BEGIN'){tx={tickets:new Set(saved.tickets),documents:new Set(saved.documents)};return rows([]);}
      if(sql==='ROLLBACK'){tx=null;rollbacks++;return rows([]);}
      if(sql==='COMMIT'){saved.tickets=tx.tickets;saved.documents=tx.documents;tx=null;commits++;return rows([]);}
      if(sql.startsWith('SET LOCAL'))return rows([]);
      if(sql.startsWith('SELECT can_read'))return rows([{can_read:options.denied?false:true}]);
      if(sql.startsWith('SELECT crm_company_id,folder_key'))return rows([{
        crm_company_id: options.wrongCompany?'different':C,folder_key:options.folder||'inbox'
      }]);
      if(sql.startsWith('SELECT id,name,relationship_state'))return rows([{
        id:C,name:options.staleCompany?'Changed name':'Synthetic Louvain',
        relationship_state:'active'
      }]);
      if(sql.startsWith('SELECT id,ticket_number,client_name'))return rows([{
        id:T,ticket_number:options.staleTicket?'Changed':'CI-001',
        client_name:'Louvain Engine',archived_at:options.archived?'2026-01-01':null
      }]);
      if(sql.startsWith('SELECT company_id FROM enkyron_crm_effective_ticket_links'))
        return rows([{company_id:options.wrongTicketCompany?'different':C}]);
      if(sql.startsWith('SELECT q.original_filename'))
        return rows([{original_filename:'synthetic.pdf',content_sha256:SHA,
          safety_state:options.unscanned?'metadata_only':'quarantined_unscanned',
          stored:!options.unscanned}]);
      if(sql.startsWith('INSERT INTO enkyron_mail_document_dossier_links')){
        if(options.failInsert && tx.documents.size===1)throw Error('synthetic disk failure');
        const key=p[5]||p[6];
        const existed=tx.documents.has(key);tx.documents.add(key);
        return {rows:existed?[]:[{link_id:p[0]}],rowCount:existed?0:1};
      }
      if(sql.startsWith('INSERT INTO enkyron_mail_ticket_links')){
        const existed=tx.tickets.has(T);tx.tickets.add(T);
        return {rows:existed?[]:[{ticket_id:T}],rowCount:existed?0:1};
      }
      if(sql.startsWith('SELECT ticket_id FROM enkyron_mail_ticket_links'))
        return rows(tx.tickets.has(T)?[{ticket_id:T}]:[]);
      if(sql.startsWith('SELECT company_id,ticket_id,content_sha256_at_review'))
        return rows([...tx.documents].map(id=>({
          company_id:id===C?C:null,ticket_id:id===T?T:null,
          content_sha256_at_review:SHA
        })));
      throw Error('Unexpected SQL: '+sql);
    },release(){}
  };
  return {pool:{connect:async()=>db},saved,calls,commits:()=>commits,rollbacks:()=>rollbacks};
}

test('refuses unconfirmed or malformed exact filing before DB connection',()=>{
  assert.equal(validateReviewedMailFiling(req).company_id,C);
  for(const change of [{confirmed:false},{thread_id:'wrong'},
    {review_note:'short'},{company_id:'wrong'},
    {filename_at_review:'../bad\x00name'},{message_id:null},
    {ticket_number_at_review:''}]){
    assert.throws(()=>validateReviewedMailFiling({...req,...change}));
  }
});

test('atomic one-transaction Mail+two document links, then idempotent exact replay',async()=>{
  const f=fixture();
  const first=await fileReviewedMailDossier(f.pool,'synthetic',req);
  assert.equal(first.verified,true);
  assert.deepEqual(first.created,{
    company_document:true,ticket_document:true,mail_ticket:true
  });
  assert.equal(first.safety_state,'quarantined_unscanned');
  assert.equal(f.commits(),1);
  assert.equal(f.saved.documents.size,2);
  assert.equal(f.saved.tickets.size,1);
  const repeat=await fileReviewedMailDossier(f.pool,'synthetic',req);
  assert.deepEqual(repeat.created,{
    company_document:false,ticket_document:false,mail_ticket:false
  });
  assert.equal(f.saved.documents.size,2);
  assert.equal(f.saved.tickets.size,1);
  assert.equal(f.commits(),2);
  assert.equal(f.calls.some(x=>/Resend|content_bytes\s*=/.test(x.sql)),false);
});

test('unauthorised, unreviewed company, stale ticket, unsafe attachment are all denied',async()=>{
  for(const args of [{denied:true},{wrongCompany:true},{wrongTicketCompany:true},
    {staleCompany:true},{staleTicket:true},{archived:true},{unscanned:true},
    {folder:'spam'}]){
    const f=fixture(args);
    await assert.rejects(fileReviewedMailDossier(f.pool,'synthetic',req));
    assert.equal(f.commits(),0);
    assert.equal(f.rollbacks(),1);
    assert.equal(f.saved.documents.size,0);
    assert.equal(f.saved.tickets.size,0);
  }
});

test('failure on second insert rolls back first insert and leaves no partial links',async()=>{
  const f=fixture({failInsert:true});
  await assert.rejects(fileReviewedMailDossier(f.pool,'synthetic',req),/disk failure/);
  assert.equal(f.commits(),0);
  assert.equal(f.rollbacks(),1);
  assert.equal(f.saved.documents.size,0);
  assert.equal(f.saved.tickets.size,0);
});

test('ticket-only and document-only are valid bounded operations',async()=>{
  const onlyTicket={...req};delete onlyTicket.message_id;delete onlyTicket.attachment_id;
  delete onlyTicket.filename_at_review;
  const a=fixture(),resA=await fileReviewedMailDossier(a.pool,'synthetic',onlyTicket);
  assert.equal(resA.created.mail_ticket,true);
  assert.equal(resA.safety_state,null);
  const onlyDocument={...req};delete onlyDocument.ticket_id;
  delete onlyDocument.ticket_number_at_review;delete onlyDocument.client_name_at_review;
  const b=fixture(),resB=await fileReviewedMailDossier(b.pool,'synthetic',onlyDocument);
  assert.equal(resB.created.company_document,true);
  assert.equal(resB.created.ticket_document,false);
  assert.equal(b.saved.tickets.size,0);
});
