import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSowDraft,readSowDraft,recordSowDraft} from '../desktop/enkyron-crm-sow-drafts.mjs';
const id='11111111-2222-4333-8444-555555555555';
const base={proposal_id:id,expected_revision:2,expected_sow_revision:0,confirmed:true,
 in_scope:'Human review of one documented AI agent workflow only.',
 out_of_scope:'No production access, penetration testing or exploitation.',
 deliverables:'Preliminary risk register, scope summary and review call.',
 acceptance_criteria:'Written report includes boundary, risks and limitations.',
 target_inventory:'Documentary only; no verified or authorised technical target.',
 dependencies:'Customer-supplied diagrams and written scope confirmation.',
 review_note:'Synthetic operator-authored SOW draft, not accepted by any party.'};
test('validates human scope without authorisation or hidden fields',()=>{
 assert.equal(validateSowDraft(base).in_scope,base.in_scope);
 for(const bad of [null,{},[],{...base,confirmed:false},{...base,proposal_id:'bad'},
  {...base,expected_revision:0},{...base,expected_sow_revision:-1},
  {...base,in_scope:'short'},{...base,acceptance_criteria:''},
  {...base,review_note:'brief'},{...base,approval_status:'approved'},
  {...base,target_inventory:'bad'+String.fromCharCode(0)+' data'}]){
  assert.throws(()=>validateSowDraft(bad),/CRM/);
 }
});
function mock({found=true,revision=2,previous=null,rows=[],missing=false}={}){
 const calls=[];let released=false;
 const query=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,title,revision'))return {rows:found?[{id,title:'Synthetic',revision}]:[]};
  if(sql.startsWith('SELECT id,proposal_revision')){
   if(missing){const e=new Error('table absent');e.code='42P01';throw e;}
   return {rows};
  }
  if(sql.startsWith('SELECT sow_revision'))return {rows:previous?[previous]:[]};
  return {rows:[]};
 };
 return {db:{connect:async()=>({query,release:()=>{released=true;}})},
   calls,get released(){return released;}};
}
test('read-only read and unavailable schema fail closed',async()=>{
 const m=mock();const r=await readSowDraft(m.db,id,'ci-user');
 assert.equal(r.current,null);
 assert.equal(r.testing_authorised,false);
 assert.equal(m.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.deepEqual(m.calls[1].params,['local:ci-user',id]);
 assert.equal(m.calls.at(-1).sql,'COMMIT');
 assert.equal(m.released,true);
 const none=await readSowDraft(mock({missing:true}).db,id,'ci-user');
 assert.equal(none.available,false);
});
test('versioning is append-only, rejects stale and no-op attempts',async()=>{
 const a=mock(),saved=await recordSowDraft(a.db,base,'ci-user',{uuid:()=>id});
 assert.equal(saved.sow_revision,1);assert.equal(saved.testing_authorised,false);
 assert.deepEqual(a.calls.map(x=>x.sql.split(' ')[0]),['BEGIN','SELECT','SELECT','INSERT','COMMIT']);
 assert.equal(a.calls[3].params[1],'local:ci-user');
 assert.equal(a.calls[3].params[4],1);
 const hash=a.calls[3].params.at(-2);
 assert.match(hash,/^[a-f0-9]{64}$/);
 const b=mock({previous:{sow_revision:1,content_sha256:hash}});
 const second=await recordSowDraft(b.db,{...base,expected_sow_revision:1,
  deliverables:base.deliverables+' Second revision.'},'ci-user',{uuid:()=>id});
 assert.equal(second.sow_revision,2);
 for(const [settings,input,match] of [
  [{revision:3},base,/proposal revision changed/],
  [{found:false},base,/not found/],
  [{previous:{sow_revision:1,content_sha256:hash}},base,/concurrently/],
  [{previous:{sow_revision:1,content_sha256:hash}},{...base,expected_sow_revision:1},/unchanged/]
 ]){
  const x=mock(settings);
  await assert.rejects(()=>recordSowDraft(x.db,input,'ci-user'),match);
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!x.calls.some(c=>c.sql.startsWith('INSERT')));
 }
});
