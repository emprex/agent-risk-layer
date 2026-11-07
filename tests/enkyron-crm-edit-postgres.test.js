import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'pg';
import {createCompany,createContact,listCompanies,listContacts}
  from '../desktop/enkyron-crm.mjs';
import {updateCompany,updateContact,listRecordChanges}
  from '../desktop/enkyron-crm-edit.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('E02 CRM editing: immutable provenance, optimistic versions, strict workspace and no consent/status change',{
  skip:!url&&'Disposable CI database only',timeout:60000
},async()=>{
  const db=new postgres.Pool({connectionString:isolated(),max:3});
  const actor='ci-edit-'+randomUUID().slice(0,8),foreign=actor+'-foreign';
  const before={};
  for(const table of ['sales_prospects','sales_messages','arl_workbench_tickets']){
    before[table]=Number((await db.query(
      'SELECT count(*)::int AS n FROM '+table)).rows[0].n);
  }
  const rationale='Source document rechecked; the local CRM address and contact details need correction.';
  try{
    const a=await createCompany(db,{
      name:'Synthetic Alpha Limited',legal_name:'Synthetic Alpha Ltd',
      sector:'Services',city:'London',country:'UK',website:'https://example.invalid'
    },actor);
    const b=await createCompany(db,{
      name:'Synthetic Alpha Limited',city:'Bristol'
    },actor);
    assert.notEqual(a.id,b.id);
    let companies=await listCompanies(db,'Synthetic Alpha Limited',actor);
    const old=companies.items.find(row=>row.id===a.id);
    assert.equal(old.record_version,1);
    assert.equal(old.relationship_state,'prospect');
    const contact=await createContact(db,{
      company_id:a.id,full_name:'Synthetic Contact',
      email:'person@example.invalid',job_title:'Engineering',phone:'01000000000'
    },actor);
    let list=await listContacts(db,a.id,actor);
    assert.equal(list.items.find(x=>x.id===contact.id).record_version,1);

    const changed=await updateCompany(db,{
      id:a.id,expected_version:1,confirmed:true,review_note:rationale,
      name:'Synthetic Alpha Limited',legal_name:'Synthetic Alpha Ltd',
      sector:'Cybersecurity',city:'London',country:'GB',website:'https://example.invalid'
    },actor);
    assert.equal(changed.record_version,2);
    assert.deepEqual(changed.changed_fields,['sector','country']);
    const edited=await updateContact(db,{
      id:contact.id,company_id:a.id,expected_version:1,confirmed:true,
      review_note:rationale,full_name:'Synthetic Contact',job_title:'Head of Engineering',
      email:'updated@example.invalid',phone:'01000000000'
    },actor);
    assert.equal(edited.record_version,2);
    assert.deepEqual(edited.changed_fields,['job_title','email']);
    companies=await listCompanies(db,'Synthetic Alpha Limited',actor);
    const after=companies.items.find(x=>x.id===a.id);
    assert.equal(after.record_version,2);
    assert.equal(after.sector,'Cybersecurity');
    assert.equal(after.country,'GB');
    assert.equal(after.relationship_state,'prospect');
    list=await listContacts(db,a.id,actor);
    assert.equal(list.items.length,1);
    assert.equal(list.items[0].record_version,2);
    assert.equal(list.items[0].email,'updated@example.invalid');
    assert.equal(list.items[0].marketing_permission,'unknown');
    assert.equal(list.items[0].relationship_state,'unverified');
    assert.equal((await listContacts(db,b.id,actor)).items.length,0);

    const ch=await listRecordChanges(db,'company',a.id,actor);
    const ct=await listRecordChanges(db,'contact',contact.id,actor);
    assert.equal(ch.record_version,2);
    assert.equal(ch.items.length,1);
    assert.deepEqual(ch.items[0].changed_fields,['sector','country']);
    assert.equal(ct.items.length,1);
    assert.deepEqual(ct.items[0].changed_fields,['job_title','email']);
    assert.equal(ct.items[0].review_note,rationale);
    assert.equal(ch.items[0].actor_local,actor);
    const events=(await db.query(
      "SELECT event_type,resource_kind FROM enkyron_crm_events "
      +"WHERE workspace_key=$1 AND resource_id=ANY($2::text[])",
      ['local:'+actor,[a.id,contact.id]]
    )).rows;
    assert.equal(events.length,4);
    assert.equal(events.filter(e=>e.event_type==='updated').length,2);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_record_changes SET review_note=$1 WHERE id=$2',
      ['tamper',ct.items[0].id]),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_record_changes WHERE id=$1',
      [ch.items[0].id]),/cannot be changed or deleted/);

    const stale={id:a.id,expected_version:1,confirmed:true,review_note:rationale,
      name:'Synthetic Alpha Limited',legal_name:'Synthetic Alpha Ltd',sector:'A',
      city:'London',country:'GB',website:'https://example.invalid'};
    await assert.rejects(()=>updateCompany(db,stale,actor),/changed; refresh/);
    await assert.rejects(()=>updateCompany(db,{...stale,expected_version:2,
      sector:'Cybersecurity'},actor),/no changed fields/);
    await assert.rejects(()=>updateCompany(db,{...stale,expected_version:2},foreign),
      /not found in local workspace/);
    await assert.rejects(()=>updateContact(db,{
      id:contact.id,company_id:b.id,expected_version:2,confirmed:true,
      review_note:rationale,full_name:'Synthetic Contact',job_title:'Different',
      email:'updated@example.invalid',phone:'01000000000'
    },actor),/cannot be moved/);
    await assert.rejects(()=>updateContact(db,{
      id:contact.id,company_id:a.id,expected_version:2,confirmed:true,
      review_note:rationale,full_name:'Synthetic Contact',job_title:'Different',
      email:'updated@example.invalid',phone:'01000000000'
    },foreign),/not found in local workspace/);
    await assert.rejects(()=>listRecordChanges(db,'company',a.id,foreign),
      /not found in local workspace/);
    await assert.rejects(()=>listRecordChanges(db,'contact',contact.id,foreign),
      /not found in local workspace/);
    assert.equal((await listCompanies(db,'Synthetic Alpha Limited',foreign)).items.length,0);
    assert.equal((await listContacts(db,a.id,actor)).items[0].record_version,2);
    assert.equal((await db.query(
      'SELECT record_version FROM enkyron_crm_companies WHERE id=$1',[a.id]
    )).rows[0].record_version,2);
    for(const [table,count] of Object.entries(before)){
      assert.equal(Number((await db.query(
        'SELECT count(*)::int AS n FROM '+table)).rows[0].n),count,
        'CRM corrections never modify the legacy source '+table);
    }
  }finally{await db.end();}
});
