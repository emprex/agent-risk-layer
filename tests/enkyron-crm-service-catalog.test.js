import test from 'node:test';
import assert from 'node:assert/strict';
import {validateServiceCatalog,createServiceCatalog,updateServiceCatalog,
  listServiceCatalog,readServiceCatalog}
  from '../desktop/enkyron-crm-service-catalog.mjs';
const uuid='11111111-2222-4333-8444-555555555555';
const event='22222222-3333-4444-8555-666666666666';
const fixed={
  service_code:'ARL-AGENT-REVIEW',name:'Agent security review',
  family:'agent_assessment',
  summary:'Bounded assessment of agreed agentic security risks and attack surfaces.',
  inclusions:'Human review of the agreed agent environment and applicable control evidence.',
  exclusions:'No production testing or additional endpoints without written authorisation.',
  deliverables:'Sourced findings, prioritised remediation advice and a bounded report.',
  prerequisites:'Written client scope and permission before any authorised technical testing.',
  technical_notes:null,
  pricing_model:'fixed',currency:'GBP',price_minor:75000,billing_period:null,
  status:'draft',review_note:'Operator draft awaiting product and price confirmation.',
  confirmed:true
};
test('catalogue validates long fiche, pricing variants and explicit manual status',()=>{
  assert.equal(validateServiceCatalog(fixed).price_minor,75000);
  assert.equal(validateServiceCatalog({...fixed,pricing_model:'fixed',
    price_minor:null,status:'draft'}).price_minor,null);
  assert.equal(validateServiceCatalog({...fixed,pricing_model:'custom_quote',
    price_minor:null,status:'available'}).price_minor,null);
  assert.equal(validateServiceCatalog({...fixed,pricing_model:'recurring',
    price_minor:12000,billing_period:'monthly',status:'available'}).billing_period,'monthly');
  for(const bad of [
    {},[],null,{...fixed,confirmed:false},{...fixed,service_code:'bad code'},
    {...fixed,service_code:'xx'},{...fixed,summary:'short'},
    {...fixed,exclusions:'short'},{...fixed,deliverables:''},
    {...fixed,prerequisites:'short'},{...fixed,family:'pentest'},
    {...fixed,pricing_model:'arbitrary'},{...fixed,status:'sent'},
    {...fixed,currency:'BTC'},{...fixed,price_minor:100.12},
    {...fixed,price_minor:-10},{...fixed,price_minor:0},
    {...fixed,pricing_model:'custom_quote',price_minor:100},
    {...fixed,pricing_model:'fixed',billing_period:'monthly'},
    {...fixed,pricing_model:'recurring',billing_period:null},
    {...fixed,pricing_model:'recurring',billing_period:'weekly'},
    {...fixed,status:'available',price_minor:null},
    {...fixed,name:'hello'+String.fromCharCode(0)},
    {...fixed,review_note:'bad'}
  ])assert.throws(()=>validateServiceCatalog(bad),/CRM/);
  assert.equal(validateServiceCatalog({...fixed,id:uuid,expected_revision:3},true).id,uuid);
  assert.throws(()=>validateServiceCatalog({...fixed,id:uuid,expected_revision:0},true),/revision/);
});
function fixture({current=null,found=true}={}){
  const calls=[];
  const client={
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes('SELECT * FROM enkyron_crm_service_catalog'))
        return {rows:found?(current?[current]:[]):[]};
      if(sql.includes('FROM enkyron_crm_service_catalog_versions'))return {rows:[]};
      if(sql.startsWith('UPDATE enkyron_crm_service_catalog'))return {rows:[{revision:2}]};
      return {rows:[]};
    },release:()=>calls.push({sql:'RELEASE'})
  };
  return {calls,pool:{connect:async()=>client,query:client.query}};
}
test('create writes only catalog + immutable snapshot in one transaction',async()=>{
  const f=fixture(),ids=[uuid,event],fn=()=>ids.shift();
  const result=await createServiceCatalog(f.pool,fixed,'operator',{uuid:fn});
  assert.equal(result.revision,1);assert.equal(result.can_issue,false);
  assert.equal(f.calls[0].sql,'BEGIN');
  assert.equal(f.calls.at(-2).sql,'COMMIT');
  assert.equal(f.calls.at(-1).sql,'RELEASE');
  const [current,snapshot]=f.calls.filter(x=>x.sql.startsWith('INSERT INTO'));
  assert.match(current.sql,/enkyron_crm_service_catalog /);
  assert.match(snapshot.sql,/enkyron_crm_service_catalog_versions/);
  assert.equal(current.params[1],'local:operator');
  assert.equal(snapshot.params[2],uuid);
  assert.match(snapshot.params.at(-1),/^[a-f0-9]{64}$/);
});
test('update rejects stale revision and never changes prior versions',async()=>{
  const f=fixture({current:{...fixed,id:uuid,revision:1}});
  const changed={...fixed,id:uuid,expected_revision:1,
    price_minor:80000,review_note:'Operator reviewed price changed for future quotes.'};
  const o=await updateServiceCatalog(f.pool,changed,'operator',{uuid:()=>event});
  assert.equal(o.revision,2);
  assert.ok(f.calls.some(x=>x.sql.startsWith('UPDATE enkyron_crm_service_catalog')));
  assert.ok(!f.calls.some(x=>x.sql.startsWith('UPDATE enkyron_crm_service_catalog_versions')));
  const stale=fixture({current:{...fixed,id:uuid,revision:2}});
  await assert.rejects(()=>updateServiceCatalog(stale.pool,changed,'operator'),/revision changed/);
  assert.equal(stale.calls.at(-2).sql,'ROLLBACK');
  const unavailable=fixture({found:false});
  await assert.rejects(()=>updateServiceCatalog(unavailable.pool,changed,'other'),/not found/);
  assert.equal(unavailable.calls[1].params[0],'local:other');
});
test('read/list are workspace scoped, read-only and do not authorise sales',async()=>{
  const f=fixture({current:{...fixed,id:uuid,revision:1}});
  const list=await listServiceCatalog(f.pool,'  ARL ','operator');
  assert.equal(list.available,true);
  assert.deepEqual(f.calls[0].params,['local:operator','ARL']);
  const detail=await readServiceCatalog(f.pool,uuid,'operator');
  assert.equal(detail.available,true);
  assert.equal(f.calls[1].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.calls.at(-2).sql,'COMMIT');
  assert.ok(f.calls.every(c=>!/^(?:UPDATE|DELETE|INSERT)\b/.test(c.sql)));
});
