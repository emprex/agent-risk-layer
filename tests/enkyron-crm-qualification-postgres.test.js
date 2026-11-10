import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {recordQualificationReview} from '../desktop/enkyron-crm-qualification.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function onlyDisposable(){
  assert.equal(process.env.CI,'true','Only disposable CI PostgreSQL');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL human qualification history is scoped and never promotes clients or consents', {
  skip:!url&&'Disposable CI PostgreSQL only',
  timeout:45_000
},async()=>{
  const db=new pg.Pool({connectionString:onlyDisposable(),max:3});
  const owner='ci-qual-'+randomUUID().slice(0,8);
  try{
    const companyName='Synthetic same-name '+randomUUID().slice(0,8);
    const a=await createCompany(db,{name:companyName,city:'London'},owner);
    const b=await createCompany(db,{name:companyName,city:'London',duplicate_review:{
       match_ids:[a.id],confirmed:true,
       review_note:'Separately reviewed synthetic company with intentionally similar name.'
     }},owner);
    const c1=await createContact(db,{company_id:a.id,full_name:'Synthetic Person A',
      email:'person-a@example.invalid'},owner);
    const c2=await createContact(db,{company_id:b.id,full_name:'Synthetic Person B',
      email:'person-b@example.invalid'},owner);
    const beforeA=(await db.query('SELECT * FROM enkyron_crm_companies WHERE id=$1',[a.id])).rows[0];
    const beforeC=(await db.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',[c1.id])).rows[0];
    const countsBefore=(await db.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n;
    const first=await recordQualificationReview(db,{
      company_id:a.id,contact_id:null,fit_status:'needs_research',priority:'normal',
      rationale:'We need to confirm the actual commercial relevance from a trusted source.',
      source_reference:'',next_action:'Review the company website manually',confirmed:true
    },owner);
    assert.equal(first.contact_id,null);
    const second=await recordQualificationReview(db,{
      company_id:a.id,contact_id:c1.id,fit_status:'potential_fit',priority:'high',
      rationale:'The operator has reviewed public technical materials, not identity or consent.',
      source_reference:'Manual source review 2026-11-06',
      next_action:'Confirm the decision maker before drafting any outreach',
      confirmed:true
    },owner);
    assert.equal(second.contact_id,c1.id);
    await assert.rejects(()=>recordQualificationReview(db,{
      company_id:a.id,contact_id:c2.id,fit_status:'potential_fit',priority:'high',
      rationale:'This contact belongs to the other company and must never be associated.',
      next_action:'Do not link without explicit review',confirmed:true
    },owner),/does not belong/);
    await assert.rejects(()=>recordQualificationReview(db,{
      company_id:a.id,contact_id:c1.id,fit_status:'not_fit',priority:'low',
      rationale:'Cross workspace is not authorized, even for an identical identifier.',
      confirmed:true
    },'ci-another'),/company not found/);
    const dossier=await getCompanyDossier(db,a.id,owner);
    const reviews=dossier.sections.qualifications;
    assert.equal(reviews.total,2);
    assert.equal(reviews.items.length,2);
    assert.ok(reviews.items.some(x=>x.subject==='Company'&&x.fit_status==='needs_research'));
    assert.ok(reviews.items.some(x=>x.subject==='Synthetic Person A'&&x.priority==='high'));
    const twin=await getCompanyDossier(db,b.id,owner);
    assert.equal(twin.sections.qualifications.total,0);
    assert.deepEqual((await db.query('SELECT * FROM enkyron_crm_companies WHERE id=$1',[a.id])).rows[0],beforeA);
    assert.deepEqual((await db.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',[c1.id])).rows[0],beforeC);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n,countsBefore);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_qualification_reviews WHERE id=$1',[first.id]
    ),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_qualification_reviews SET fit_status=$1 WHERE id=$2',
      ['not_fit',second.id]
    ),/cannot be changed or deleted/);
    assert.equal((await db.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_qualification_reviews WHERE company_id=$1',
      [a.id]
    )).rows[0].n,2);
  }finally{await db.end();}
});
