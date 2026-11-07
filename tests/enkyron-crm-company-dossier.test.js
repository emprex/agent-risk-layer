import test from 'node:test';
import assert from 'node:assert/strict';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';

const company='11111111-2222-4333-8444-555555555555';
const names=['contacts','prospects','tickets','opportunities','activities','qualifications','drafts','audit_events','audit_changes'];
function mockDatabase({total='1',badSection='',missing=false,notFound=false}={}){
  const statements=[];
  let releases=0;
  const db={
    connect:async()=>({
      query:async(sql,params)=>{
        statements.push({sql,params});
        if(sql.startsWith('SELECT id,name,legal_name')){
          return {rows:notFound?[]:[{id:company,name:'Synthetic Ltd',relationship_state:'prospect'}]};
        }
        if(sql.startsWith('SELECT')&&!sql.startsWith('SELECT id,name,legal_name')){
          if(missing){const e=new Error('not installed');e.code='42P01';throw e;}
          if(sql.startsWith('SELECT id,full_name,job_title,email'))return {rows:[{id:'contact',total_rows:badSection==='contacts'?'-2':total}]};
          return {rows:[]};
        }
        return {rows:[]};
      },
      release:()=>{releases++;}
    })
  };
  return {db,statements,released:()=>releases};
}
test('reads only explicitly linked records under repeatable-read snapshot',async()=>{
  const m=mockDatabase();
  const result=await getCompanyDossier(m.db,company,'ci-operator');
  assert.equal(result.company.name,'Synthetic Ltd');
  assert.deepEqual(Object.keys(result.sections),names);
  assert.equal(result.sections.contacts.total,1);
  assert.equal(result.sections.contacts.items.length,1);
  assert.equal(result.sections.tickets.total,0);
  assert.equal(result.sections.prospects.total,0);
  assert.deepEqual(m.statements.map(s=>s.sql.match(/^[A-Z]+/)[0]),[
    'BEGIN','SELECT','SELECT','SELECT','SELECT','SELECT','SELECT','SELECT','SELECT','SELECT','SELECT','COMMIT'
  ]);
  assert.match(m.statements[0].sql,/REPEATABLE READ READ ONLY/);
  assert.equal(m.released(),1);
  assert.ok(m.statements.every(q=>!/\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i.test(q.sql)));
  for(const q of m.statements.filter(q=>q.params)){
    assert.deepEqual(q.params,['local:ci-operator',company]);
  }
  assert.ok(m.statements.slice(2,11).every(q=>/LIMIT 21/.test(q.sql)));
  assert.match(m.statements[9].sql,/FROM enkyron_crm_events/);
  assert.match(m.statements[10].sql,/FROM enkyron_crm_record_changes/);
  for(const sql of [m.statements[9].sql,m.statements[10].sql]){
    assert.match(sql,/c[.]workspace_key/);
    assert.match(sql,/c[.]company_id=[$]2/);
    assert.doesNotMatch(sql,/review_note|recipient_email|phone|source_reference/);
  }
  // Opportunity, notes and drafts are linked through explicit prospect association.
  for(const sql of [m.statements[5],m.statements[6],m.statements[8]].map(q=>q.sql)){
    assert.match(sql,/enkyron_crm_prospect_links/);
    assert.match(sql,/workspace_key/);
  }
});
test('reject invalid operator, bad ID, missing company, and malformed counts',async()=>{
  const m=mockDatabase();
  await assert.rejects(()=>getCompanyDossier(m.db,'bad','ci-operator'),/CRM/);
  await assert.rejects(()=>getCompanyDossier(m.db,company,'operator name'),/CRM/);
  assert.equal(m.statements.length,0);
  for(const option of [{notFound:true},{badSection:'contacts'}]){
    const n=mockDatabase(option);
    await assert.rejects(()=>getCompanyDossier(n.db,company,'ci-operator'),/CRM/);
    assert.equal(n.statements.at(-1).sql,'ROLLBACK');
    assert.equal(n.released(),1);
  }
});
test('missing schema reports unavailable and does not invent company data',async()=>{
  const m=mockDatabase({missing:true});
  const res=await getCompanyDossier(m.db,company,'ci-operator');
  assert.equal(res.available,false);
  assert.ok(!res.company);
  assert.equal(m.statements.at(-1).sql,'ROLLBACK');
  assert.equal(m.released(),1);
});
test('preview is capped at twenty entries while retaining exact counts',async()=>{
  const queries=[];
  const db={connect:async()=>({
    query:async(sql,params)=>{
      queries.push(sql);
      if(sql.startsWith('SELECT id,name,legal_name'))
        return {rows:[{id:company,name:'Capped Company'}]};
      if(sql.startsWith('SELECT id,full_name,job_title,email'))
        return {rows:Array.from({length:21},(_,i)=>({
          id:'c'+i,full_name:'Person '+i,total_rows:'22'
        }))};
      return {rows:[]};
    },release:()=>{}
  })};
  const result=await getCompanyDossier(db,company,'ci-operator');
  assert.equal(result.sections.contacts.total,22);
  assert.equal(result.sections.contacts.items.length,20);
  assert.equal(result.sections.contacts.more,true);
  assert.equal('total_rows' in result.sections.contacts.items[0],false);
});
