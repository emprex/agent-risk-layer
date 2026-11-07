import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBuyerReview,readBuyerReview,recordBuyerReview}
  from '../desktop/enkyron-crm-buyer-review.mjs';
const id='11111111-2222-4333-8444-555555555555';
const company='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base={proposal_id:id,company_id:company,expected_revision:2,confirmed:true,
  legal_name:'Synthetic Linked Buyer Ltd',
  registered_address:'10 Fictional Avenue, Test City, UK',
  source_reference:'Synthetic company registry fixture',
  review_note:'Manually transcribed synthetic record, not independently verified.'};
test('buyer review validation requires linked company identifier and traceable source',()=>{
  assert.equal(validateBuyerReview(base).legal_name,base.legal_name);
  for(const bad of [null,{},[],{...base,confirmed:false},
    {...base,expected_revision:0},{...base,proposal_id:'wrong'},
    {...base,company_id:'wrong'},{...base,legal_name:'X'},
    {...base,registered_address:'short'},{...base,source_reference:'ab'},
    {...base,review_note:'short'}, {...base,legal_name:'Injected\nMore'}]){
      assert.throws(()=>validateBuyerReview(bad),/CRM/);
  }
});
function mockDB({linked=true,stale=false,already=false}={}){
  const queries=[];let released=false;
  const proposal={id,revision:stale?3:2,research_candidate:'Research Candidate',
    company_id:linked?company:null,
    company_name:linked?'Synthetic CRM Buyer':null,
    company_legal_name:'Synthetic Linked Buyer Ltd'};
  const client={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('SELECT d.id'))return {rows:[proposal]};
    if(sql.startsWith('SELECT id FROM enkyron_crm_proposal_buyer_reviews'))
      return {rows:already?[{id:'prev'}]:[]};
    if(sql.startsWith('SELECT proposal_revision'))return {rows:[]};
    return {rows:[]};
  },release:()=>{released=true}};
  return {pool:{connect:async()=>client,query:client.query},queries,get released(){return released;}};
}
test('read shows only explicitly linked company, not inferred buyer',async()=>{
  const m=mockDB({linked:false});
  const view=await readBuyerReview(m.pool,id,'ci-user');
  assert.equal(view.linked_company,null);
  assert.equal(view.current,null);
  assert.deepEqual(m.queries[0].params,['local:ci-user',id]);
  const a=mockDB();
  assert.equal((await readBuyerReview(a.pool,id,'ci-user')).linked_company.id,company);
});
test('write is immutable, scoped, version-bound and confirms human link',async()=>{
  const m=mockDB();
  const result=await recordBuyerReview(m.pool,base,'ci-user',{uuid:()=>id});
  assert.equal(result.review_status,'operator_documented_unverified');
  assert.equal(m.queries.some(x=>/^UPDATE\b|^DELETE\b/.test(x.sql)),false);
  assert.deepEqual(m.queries.map(x=>x.sql.split(' ')[0]),
    ['BEGIN','SELECT','SELECT','INSERT','COMMIT']);
  assert.equal(m.queries[3].params[1],'local:ci-user');
  assert.equal(m.released,true);
  for(const variant of [{linked:false},{stale:true},{already:true}]){
    const check=mockDB(variant);
    await assert.rejects(()=>recordBuyerReview(check.pool,base,'ci-user'),/CRM/);
    assert.equal(check.queries.at(-1).sql,'ROLLBACK');
    assert.equal(check.queries.some(x=>x.sql.startsWith('INSERT')),false);
  }
});
