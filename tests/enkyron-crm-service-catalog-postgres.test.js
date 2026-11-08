import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createServiceCatalog,updateServiceCatalog,listServiceCatalog,
  readServiceCatalog} from '../desktop/enkyron-crm-service-catalog.mjs';
const uri=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true','Only the disposable CI PostgreSQL is allowed');
  const u=new URL(uri);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return uri;
}
const content={
  name:'Agent security review — synthetic',
  family:'agent_assessment',
  summary:'Synthetic service for CI testing only, not a real commercial commitment.',
  inclusions:'Operator-approved documentary review of a synthetic agent architecture.',
  exclusions:'No testing of any real system, customer network or external environment.',
  deliverables:'Synthetic risk review and example remediation guidance, not an assurance claim.',
  prerequisites:'A human must verify exact scope and written permissions before technical testing.',
  technical_notes:'Sample mapping only; no security test is performed by this catalog workflow.',
  currency:'GBP',pricing_model:'fixed',price_minor:null,billing_period:null,
  status:'draft',review_note:'Human-labelled synthetic test; not an approved published ARL service.',
  confirmed:true
};
test('E07-02 PostgreSQL: scoped fiche, price models, immutable versions, no quote mutation',{
  skip:!uri&&'Disposable CI PostgreSQL only',timeout:55_000
},async()=>{
  const db=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-catalog-'+randomUUID().slice(0,9);
  const code='ARL-CI-'+randomUUID().slice(0,8).toUpperCase();
  try{
    const initial=await createServiceCatalog(db,{
      ...content,service_code:code
    },actor);
    assert.equal(initial.revision,1);
    assert.equal(initial.can_issue,false);
    const before=await readServiceCatalog(db,initial.id,actor);
    assert.equal(before.service.status,'draft');
    assert.equal(before.service.price_minor,null);
    assert.equal(before.history.length,1);
    const updated=await updateServiceCatalog(db,{
      ...content,service_code:code,id:initial.id,expected_revision:1,
      status:'available',price_minor:95000,
      review_note:'Human test operator made this synthetic service selectable for a quote draft.'
    },actor);
    assert.equal(updated.revision,2);
    const listing=await listServiceCatalog(db,code,actor);
    assert.equal(listing.items.length,1);
    assert.equal(listing.items[0].price_minor,'95000');
    assert.equal(listing.items[0].status,'available');
    await assert.rejects(()=>updateServiceCatalog(db,{
      ...content,service_code:code,id:initial.id,expected_revision:1,
      status:'available',price_minor:100000,
      review_note:'This is an intentionally stale update and must be rejected.'
    },actor),/revision changed/);
    const second=await updateServiceCatalog(db,{
      ...content,service_code:code,id:initial.id,expected_revision:2,
      status:'available',price_minor:125000,
      review_note:'The synthetic price is revised but the previous snapshot must remain unchanged.'
    },actor);
    assert.equal(second.revision,3);
    const history=await readServiceCatalog(db,initial.id,actor);
    assert.deepEqual(history.history.map(x=>x.revision),[3,2,1]);
    assert.deepEqual(history.history.map(x=>x.price_minor),['125000','95000',null]);
    assert.deepEqual(history.history.map(x=>x.status),['available','available','draft']);
    const other=await listServiceCatalog(db,code,actor+'-foreign');
    assert.equal(other.items.length,0);
    await assert.rejects(()=>readServiceCatalog(db,initial.id,actor+'-foreign'),/not found/);
    await assert.rejects(()=>createServiceCatalog(db,{
      ...content,service_code:code
    },actor),/duplicate key|unique constraint/i);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_service_catalog_versions SET price_minor=1 WHERE workspace_key=$1 AND service_id=$2',
      ['local:'+actor,initial.id]),/cannot be changed|immutable|may not|update/i);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_service_catalog_versions WHERE workspace_key=$1 AND service_id=$2',
      ['local:'+actor,initial.id]),/cannot be changed|immutable|may not|delete/i);
    const custom=await createServiceCatalog(db,{
      ...content,service_code:code+'-CUSTOM',pricing_model:'custom_quote',
      price_minor:null,status:'available',
      review_note:'Custom quote requires pricing for the specific engagement and operator review.'
    },actor);
    assert.equal((await readServiceCatalog(db,custom.id,actor)).service.price_minor,null);
    const recurring=await createServiceCatalog(db,{
      ...content,service_code:code+'-REC',pricing_model:'recurring',
      price_minor:15000,billing_period:'monthly',status:'available',
      review_note:'Synthetic monthly base fee only; no subscription agreement exists.'
    },actor);
    const rec=(await readServiceCatalog(db,recurring.id,actor)).service;
    assert.equal(rec.billing_period,'monthly');
    assert.equal(rec.price_minor,'15000');
    assert.equal((await db.query(
      'SELECT COUNT(*)::int AS n FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1',
      ['local:'+actor]
    )).rows[0].n,0);
  }finally{await db.end();}
});
