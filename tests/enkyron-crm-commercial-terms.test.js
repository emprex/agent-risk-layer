import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommercialTerms,readCommercialTerms,recordCommercialTerms}
  from '../desktop/enkyron-crm-commercial-terms.mjs';
const id='11111111-2222-4333-8444-555555555555';
const base={proposal_id:id,expected_revision:2,confirmed:true,valid_until:'2026-12-31',
  payment_terms:'Payment terms proposed, subject to approval by both parties.',
  delivery_terms:'Delivery schedule must be agreed in writing before any work starts.',
  exclusions:'No remediation or live-system access is included in this working proposal.',
  assumptions:'Any work requires separate written authorisation and agreed scope.',
  source_reference:'Manual commercial draft fixture'};
test('commercial terms reject omissions, invalid dates and unapproved claims',()=>{
  const x=validateCommercialTerms(base);
  assert.equal(x.valid_until,'2026-12-31');
  assert.equal(x.payment_terms,base.payment_terms);
  assert.ok(!('vat_rate' in x));
  for(const bad of [null,{},[],{...base,confirmed:false},{...base,expected_revision:0},
    {...base,proposal_id:'bad'},{...base,valid_until:'2026-02-30'},
    {...base,valid_until:'2026-13-05'},{...base,valid_until:'tomorrow'},
    {...base,payment_terms:'x'},{...base,delivery_terms:'short'},
    {...base,exclusions:'x'},{...base,assumptions:'short'},
    {...base,source_reference:'ab'},
    {...base,payment_terms:'unsafe'+String.fromCharCode(0)+' secret'}]){
    assert.throws(()=>validateCommercialTerms(bad),/CRM/);
  }
});
function mock({currentRevision=2,hasTerms=false,found=true}={}){
  const calls=[];let released=false;
  const q=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT id,revision,title'))return {rows:found?[{
      id,revision:currentRevision,title:'Synthetic proposal draft'}]:[]};
    if(sql.startsWith('SELECT revision FROM'))return {rows:found?[{revision:currentRevision}]:[]};
    if(sql.startsWith('SELECT id FROM enkyron_crm_proposal_commercial_terms'))
      return {rows:hasTerms?[{id:'present'}]:[]};
    if(sql.startsWith('SELECT id,proposal_revision'))return {rows:[]};
    return {rows:[]};
  };
  return {db:{query:q,connect:async()=>({query:q,release(){released=true;}})},
    calls,get released(){return released;}};
}
test('read only scopes to OS operator; missing schema is explicit',async()=>{
  const a=mock();
  const out=await readCommercialTerms(a.db,id,'local-user');
  assert.equal(out.current,null);
  assert.deepEqual(a.calls[0].params,['local:local-user',id]);
  assert.deepEqual(a.calls[1].params,['local:local-user',id]);
  const missing=await readCommercialTerms({query:async()=>{
    const e=new Error('no table');e.code='42P01';throw e;
  }},id,'local-user');
  assert.equal(missing.available,false);
});
test('writes one immutable revision in transaction and rejects stale/missing/duplicate',async()=>{
  const a=mock();
  const saved=await recordCommercialTerms(a.db,base,'local-user',{uuid:()=>id});
  assert.equal(saved.review_status,'operator_draft_unapproved');
  assert.deepEqual(a.calls.map(x=>x.sql.split(' ')[0]),
    ['BEGIN','SELECT','SELECT','INSERT','COMMIT']);
  assert.equal(a.calls[3].params[1],'local:local-user');
  assert.equal(a.calls[3].params[4],'2026-12-31');
  assert.equal(a.released,true);
  assert.equal(a.calls.some(x=>/^\s*(UPDATE|DELETE)\b/.test(x.sql)),false);
  for(const config of [{currentRevision:3},{found:false},{hasTerms:true}]){
    const b=mock(config);
    await assert.rejects(()=>recordCommercialTerms(b.db,base,'local-user'),/CRM/);
    assert.equal(b.calls.at(-1).sql,'ROLLBACK');
    assert.equal(b.calls.some(x=>x.sql.startsWith('INSERT')),false);
  }
});
