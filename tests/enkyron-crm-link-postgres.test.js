import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { previewProspectLink,associateProspect } from '../desktop/enkyron-crm-link.mjs';
import { createCompany } from '../desktop/enkyron-crm.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function safeUrl(){
  assert.equal(process.env.CI,'true','Only disposable CI PostgreSQL is permitted');
  const parsed=new URL(url);
  assert.equal(parsed.hostname,'127.0.0.1');
  assert.equal(parsed.pathname,'/arl_ci');
  assert.equal(parsed.username,'arl_ci');
  assert.equal(parsed.password,'synthetic-ci-only');
  return url;
}
const rationale='Reviewed the synthetic research source and confirmed its company association.';
test('real CI PostgreSQL: explicit review, no duplicate company and immutable provenance', {
  skip:!url && 'Only disposable CI PostgreSQL permitted', timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:safeUrl(),max:2});
  const operator='ci-operator';
  try{
    await pool.query(
      "INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)",
      ['usr_enkyron_link_ci','enkyron-link-ci@example.invalid','synthetic-only',new Date().toISOString()]
    );
    const now=new Date().toISOString();
    for(const [id,name,website] of [
      ['lead_link_ci_1','Prospect CI Unique','https://prospect-ci.example.invalid'],
      ['lead_link_ci_2','Prospect CI Unique','https://prospect-ci.example.invalid'],
      ['lead_link_ci_3','Prospect CI Existing','https://known-ci.example.invalid']
    ]){
      await pool.query(
        'INSERT INTO sales_prospects(id,company_name,website,created_by,source,created_at,updated_at) '
         +'VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id,name,website,'usr_enkyron_link_ci','synthetic-research',now,now]
      );
    }
    const priorContactCount=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_contacts'
    )).rows[0].n;
    const initial=(await pool.query(
      "SELECT id,company_name,website,updated_at FROM sales_prospects WHERE id LIKE 'lead_link_ci_%' ORDER BY id"
    )).rows;
    const first=await previewProspectLink(pool,'lead_link_ci_1',operator);
    assert.equal(first.available,true);
    assert.equal(first.linked,null);
    assert.deepEqual(first.matches,[]);
    const a=await associateProspect(pool,{
      prospect_id:'lead_link_ci_1',source_digest:first.source_digest,
      mode:'create',review_note:rationale,reviewed:true
    },operator);
    assert.equal(a.company_created,true);
    const after=await previewProspectLink(pool,'lead_link_ci_1',operator);
    assert.equal(after.linked.company_id,a.company_id);
    await assert.rejects(()=>associateProspect(pool,{
      prospect_id:'lead_link_ci_1',source_digest:first.source_digest,
      mode:'create',review_note:rationale,reviewed:true
    },operator),/already linked/);
    const second=await previewProspectLink(pool,'lead_link_ci_2',operator);
    assert.ok(second.matches.some(x=>x.id===a.company_id));
    await assert.rejects(()=>associateProspect(pool,{
      prospect_id:'lead_link_ci_2',source_digest:second.source_digest,
      mode:'create',review_note:rationale,reviewed:true
    },operator),/possible duplicate/);
    const linked=await associateProspect(pool,{
      prospect_id:'lead_link_ci_2',source_digest:second.source_digest,
      mode:'existing',company_id:a.company_id,review_note:rationale,reviewed:true
    },operator);
    assert.equal(linked.company_created,false);
    const existing=await createCompany(pool,{
      name:'Prospect CI Existing',website:'https://known-ci.example.invalid'
    },operator);
    const third=await previewProspectLink(pool,'lead_link_ci_3',operator);
    assert.ok(third.matches.some(x=>x.id===existing.id));
    const link=await associateProspect(pool,{
      prospect_id:'lead_link_ci_3',source_digest:third.source_digest,
      mode:'existing',company_id:existing.id,review_note:rationale,reviewed:true
    },operator);
    assert.equal(link.company_id,existing.id);
    const other=await previewProspectLink(pool,'lead_link_ci_1','other-operator');
    assert.equal(other.linked,null);
    await assert.rejects(()=>associateProspect(pool,{
      prospect_id:'lead_link_ci_3',source_digest:third.source_digest,
      mode:'existing',company_id:existing.id,review_note:rationale,reviewed:true
    },'other-operator'),/company not found/);
    const count=(await pool.query(
      "SELECT count(*)::int AS n FROM enkyron_crm_prospect_links WHERE prospect_id LIKE 'lead_link_ci_%'"
    )).rows[0].n;
    assert.equal(count,3);
    const links=(await pool.query(
      "SELECT source_digest,review_note FROM enkyron_crm_prospect_links WHERE prospect_id='lead_link_ci_1'"
    )).rows;
    assert.equal(links[0].source_digest,first.source_digest);
    assert.equal(links[0].review_note,rationale);
    await assert.rejects(
      ()=>pool.query("DELETE FROM enkyron_crm_prospect_links WHERE prospect_id='lead_link_ci_1'"),
      /cannot be changed or deleted/
    );
    const final=(await pool.query(
      "SELECT id,company_name,website,updated_at FROM sales_prospects WHERE id LIKE 'lead_link_ci_%' ORDER BY id"
    )).rows;
    assert.deepEqual(final,initial,'historical prospect source rows must not be rewritten');
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_contacts'
    )).rows[0].n,priorContactCount);
  }finally{await pool.end();}
});
