import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceDigest, requireProspectId, validateProspectLink,
  previewProspectLink, associateProspect
} from '../desktop/enkyron-crm-link.mjs';

const prospect={id:'legacy_one',company_name:'Example Ltd',website:'https://example.invalid',
  buyer_name:'Unverified',buyer_role:'CTO',buyer_email:null,source:'import',updated_at:'2026-08-10'};
const companyId='11111111-2222-4333-8444-555555555555';
const digest=sourceDigest(prospect);
const valid={prospect_id:'legacy_one',source_digest:digest,mode:'create',
  review_note:'Reviewed published company source and chosen identity mapping.',
  reviewed:true};
test('requires an explicit review, snapshot digest and one valid destination',()=>{
  assert.equal(requireProspectId('legacy_one'),'legacy_one');
  assert.equal(sourceDigest({...prospect,buyer_name:'different'})!==digest,true);
  for(const invalid of [
    {...valid,reviewed:false},{...valid,review_note:'short'},
    {...valid,source_digest:'a'},{...valid,company_id:companyId},
    {...valid,mode:'merge'},{...valid,prospect_id:'\n'},
    {...valid,mode:'existing',company_id:'x'},
    {...valid,mode:'existing',company_id:companyId,review_note:' '}
  ]) assert.throws(()=>validateProspectLink(invalid),/CRM/);
  assert.equal(validateProspectLink({...valid,mode:'existing',company_id:companyId}).company_id,companyId);
});
test('preview returns provenance and duplicate indicators without mutation',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM sales_prospects'))return {rows:[prospect]};
    if(sql.includes('FROM enkyron_crm_prospect_links'))return {rows:[]};
    return {rows:[{id:companyId,name:'Example Ltd',website:'https://example.invalid'}]};
  }};
  const result=await previewProspectLink(pool,'legacy_one','ci-operator');
  assert.equal(result.available,true);
  assert.equal(result.source_digest,digest);
  assert.equal(result.matches.length,1);
  assert.deepEqual(calls[2].params,['local:ci-operator','Example Ltd','example.invalid']);
  assert.ok(calls.every(c=>/^\s*SELECT /.test(c.sql)));
  const missing=await previewProspectLink({query:async()=>{
    const e=new Error('missing');e.code='42P01';throw e;
  }},'legacy_one','ci-operator');
  assert.equal(missing.available,false);
});
test('transactional link prevents stale record, already linked and duplicate new company',async()=>{
  const run=async(mode,flags={})=>{
    const calls=[];
    const client={
      query:async(sql,params)=>{
        calls.push({sql,params});
        if(sql.includes('FROM sales_prospects'))return {rows:[flags.stale?{...prospect,source:'changed'}:prospect]};
        if(sql.includes('FROM enkyron_crm_prospect_links'))return {rows:flags.already?[{company_id:companyId}]:[]};
        if(sql.includes('SELECT id,name,website'))return {rows:flags.duplicate?[{id:companyId}]:[]};
        if(sql.includes('WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE'))return {rows:flags.notFound?[]:[{id:companyId}]};
        return {rows:[]};
      },release:()=>{calls.push({sql:'RELEASE'});}
    };
    const pool={connect:async()=>client};
    let seq=0;const ids=[companyId,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee','cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
    let result,error;
    try{result=await associateProspect(pool,{...valid,mode,
      ...(mode==='existing'?{company_id:companyId}:{})},'ci-operator',
      {uuid:()=>ids[seq++]});}catch(e){error=e;}
    return {calls,result,error};
  };
  for(const flags of [{stale:true},{already:true},{duplicate:true}]){
    const {calls,error}=await run('create',flags);
    assert.match(error.message,/CRM/);
    assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
    assert.ok(!calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_prospect_links')));
  }
  const created=await run('create');
  assert.equal(created.result.company_created,true);
  assert.equal(created.result.company_id,companyId);
  assert.ok(created.calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_companies')));
  assert.ok(created.calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_prospect_links')));
  assert.ok(created.calls.some(c=>c.sql==='COMMIT'));
  const linked=await run('existing');
  assert.equal(linked.result.company_created,false);
  assert.ok(!linked.calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_companies')));
  assert.ok(linked.calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_prospect_links')));
  assert.deepEqual(linked.calls.filter(c=>c.sql.startsWith('INSERT INTO enkyron_crm_prospect_links'))[0].params.slice(1,4),
    ['local:ci-operator','legacy_one',companyId]);
  assert.match((await run('existing',{notFound:true})).error.message,/company not found/);
});
