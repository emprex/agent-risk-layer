import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUnifiedMailFiling,previewUnifiedMailFiling,commitUnifiedMailFiling}
  from '../desktop/enkyron-mail-unified-filing.mjs';

const THREAD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TICKET='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MESSAGE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ATTACHMENT='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SHA='a'.repeat(64);
function request(){
  return {mailbox:'direction',thread_id:THREAD,
    company_id:COMPANY,company_name_at_review:'Louvain AI',
    ticket:{ticket_id:TICKET,ticket_number_at_review:'ARL-2026-000009',
      client_name_at_review:'Louvain AI'},
    attachment:{message_id:MESSAGE,attachment_id:ATTACHMENT,
      content_sha256_at_review:SHA,destinations:['company','ticket']},
    review_note:'Reviewed synthetic message and attachment for Louvain AI ticket.',
    confirmed:true};
}
class FakeDb{
  constructor(){
    this.companyOnThread=null;this.ticketLink=false;
    this.documents=new Set();this.calls=[];this.releases=0;
    this.readAllowed=true;this.attachmentStored=true;
    this.ticketCompany=COMPANY;this.failDocumentLink=false;
    this.tx=null;
  }
  async connect(){return this;}
  release(){this.releases++;}
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql==='BEGIN'){
      this.tx={company:this.companyOnThread,ticket:this.ticketLink,
        documents:new Set(this.documents)};
      return {rows:[]};
    }
    if(sql==='COMMIT'){this.tx=null;return {rows:[]};}
    if(sql==='ROLLBACK'){
      if(this.tx){
        this.companyOnThread=this.tx.company;
        this.ticketLink=this.tx.ticket;
        this.documents=new Set(this.tx.documents);
      }
      this.tx=null;return {rows:[]};
    }
    if(sql.includes('FROM enkyron_local_mail_access'))
      return {rows:[{can_read:this.readAllowed}]};
    if(sql.includes('FROM enkyron_mail_local_threads'))
      return {rows:[{crm_company_id:this.companyOnThread,folder_key:'inbox',
        subject:'test piece jointe'}]};
    if(sql.includes('FROM enkyron_crm_companies'))
      return {rows:[{id:COMPANY,name:'Louvain AI',relationship_state:'prospect'}]};
    if(sql.includes('FROM arl_workbench_tickets'))
      return {rows:[{id:TICKET,ticket_number:'ARL-2026-000009',
        title:'Louvain Engine — Independent AI Security Assessment',
        client_name:'Louvain AI',status:'pending_review',archived_at:null}]};
    if(sql.includes('FROM enkyron_crm_effective_ticket_links'))
      return {rows:this.ticketCompany?[{company_id:this.ticketCompany}]:[]};
    if(sql.startsWith('SELECT ticket_id FROM enkyron_mail_ticket_links'))
      return {rows:this.ticketLink?[{ticket_id:TICKET}]:[]};
    if(sql.includes('FROM enkyron_mail_attachment_quarantine'))
      return {rows:[{original_filename:'ARL-Louvain-Report-READONLY.pdf',
        content_sha256:SHA,safety_state:'quarantined_unscanned',
        stored:this.attachmentStored}]};
    if(sql.startsWith('SELECT link_id FROM enkyron_mail_document_dossier_links')){
      const kind=sql.includes('company_id=$5')?'company':'ticket';
      return {rows:this.documents.has(kind+':'+params[4])?[{link_id:'old'}]:[]};
    }
    if(sql.startsWith('UPDATE enkyron_mail_local_threads')){
      this.companyOnThread=params[3];
      return {rowCount:1,rows:[{crm_company_id:this.companyOnThread}]};
    }
    if(sql.startsWith('INSERT INTO enkyron_mail_ticket_links')){
      if(this.ticketLink)return {rowCount:0,rows:[]};
      this.ticketLink=true;return {rowCount:1,rows:[{ticket_id:TICKET}]};
    }
    if(sql.startsWith('INSERT INTO enkyron_mail_document_dossier_links')){
      if(this.failDocumentLink)throw Error('simulated insert failure');
      const kind=params[5]?'company':'ticket';
      const target=params[5]||params[6];
      if(this.documents.has(kind+':'+target))return {rowCount:0,rows:[]};
      this.documents.add(kind+':'+target);
      return {rowCount:1,rows:[{link_id:params[0]}]};
    }
    throw Error('Unexpected SQL in test: '+sql);
  }
}
test('review requires exact identifiers, a rationale and explicit consent',()=>{
  const input=request();
  assert.equal(validateUnifiedMailFiling(input,{commit:true}).review_note,input.review_note);
  assert.throws(()=>validateUnifiedMailFiling({...input,confirmed:false},{commit:true}),
    /human review/);
  assert.throws(()=>validateUnifiedMailFiling({...input,review_note:'short'},{commit:true}),
    /filing rationale/);
  assert.throws(()=>validateUnifiedMailFiling({...input,company_id:'bad'},{commit:true}),
    /CRM company/);
  assert.throws(()=>validateUnifiedMailFiling({...input,
    attachment:{...input.attachment,destinations:['ticket','ticket']}},{commit:true}),
    /destinations/);
});
test('read-only preview identifies proposals and never mutates DB',async()=>{
  const db=new FakeDb();
  const plan=await previewUnifiedMailFiling(db,'emprex',request());
  assert.equal(plan.preview,true);
  assert.equal(plan.company.status,'will_link');
  assert.equal(plan.ticket.status,'will_link');
  assert.deepEqual(plan.attachment.destinations.map(x=>x.status),['will_link','will_link']);
  assert.equal(db.calls.some(x=>/^(BEGIN|UPDATE|INSERT|COMMIT)/.test(x.sql)),false);
  assert.equal(db.companyOnThread,null);
});
test('one confirmed operation links company, ticket and one quarantine file to two dossiers',async()=>{
  const db=new FakeDb();
  const result=await commitUnifiedMailFiling(db,'emprex',request());
  assert.equal(result.saved,true);
  assert.equal(result.entries.company,'linked');
  assert.equal(result.entries.ticket,'linked');
  assert.deepEqual(result.entries.documents.map(x=>x.status),['linked','linked']);
  assert.equal(result.safety_state,'quarantined_unscanned');
  assert.equal(db.companyOnThread,COMPANY);
  assert.equal(db.ticketLink,true);
  assert.equal(db.documents.size,2);
  assert.equal(db.calls.filter(x=>x.sql==='COMMIT').length,1);
  assert.equal(db.releases,1);
  assert.ok(db.calls.some(x=>x.sql.startsWith('SELECT link_id FROM enkyron_mail_document_dossier_links')));
});
test('replaying a confirmed request reports already linked, without new writes',async()=>{
  const db=new FakeDb();
  await commitUnifiedMailFiling(db,'emprex',request());
  const writes=db.calls.filter(x=>/^(UPDATE|INSERT)/.test(x.sql)).length;
  const result=await commitUnifiedMailFiling(db,'emprex',request());
  assert.equal(result.entries.company,'already_linked');
  assert.equal(result.entries.ticket,'already_linked');
  assert.deepEqual(result.entries.documents.map(x=>x.status),['already_linked','already_linked']);
  assert.equal(db.calls.filter(x=>/^(UPDATE|INSERT)/.test(x.sql)).length,writes);
});
test('mismatched company vs ticket fails without writes',async()=>{
  const db=new FakeDb();db.ticketCompany=THREAD;
  await assert.rejects(commitUnifiedMailFiling(db,'emprex',request()),/not a verified match/);
  assert.equal(db.companyOnThread,null);
  assert.equal(db.ticketLink,false);
  assert.equal(db.calls.some(x=>/^(UPDATE|INSERT)/.test(x.sql)),false);
  assert.equal(db.calls.filter(x=>x.sql==='ROLLBACK').length,1);
});
test('unretrieved attachment cannot be linked or marked safe',async()=>{
  const db=new FakeDb();db.attachmentStored=false;
  await assert.rejects(commitUnifiedMailFiling(db,'emprex',request()),/quarantine first/);
  assert.equal(db.documents.size,0);
  assert.equal(db.companyOnThread,null);
});
test('database error rolls back company and ticket along with document associations',async()=>{
  const db=new FakeDb();db.failDocumentLink=true;
  await assert.rejects(commitUnifiedMailFiling(db,'emprex',request()),/simulated insert failure/);
  assert.equal(db.companyOnThread,null);
  assert.equal(db.ticketLink,false);
  assert.equal(db.documents.size,0);
  assert.equal(db.calls.filter(x=>x.sql==='ROLLBACK').length,1);
});
test('mailbox permission is checked by backend before writes',async()=>{
  const db=new FakeDb();db.readAllowed=false;
  await assert.rejects(commitUnifiedMailFiling(db,'emprex',request()),/permission denied/);
  assert.equal(db.companyOnThread,null);
  assert.equal(db.ticketLink,false);
});
