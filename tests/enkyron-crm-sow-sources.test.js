import test from 'node:test';
import assert from 'node:assert/strict';
import {readSowSources} from '../desktop/enkyron-crm-sow-sources.mjs';
const id='11111111-2222-4333-8444-555555555555';
const fixture={id,revision:2,title:'Synthetic work statement',
  scope_text:'Review the documented AI agent architecture; no live tests.',
  currency:'GBP',amount_minor:'75000',
  company_name_at_creation:'Research lead',buyer_origin:'research_candidate',
  effective_origin:false};
function mock({proposal=fixture,lines=[],terms=null,sow=null,missing=false}={}){
 const queries=[];let released=false;
 const pool={connect:async()=>({
  query:async(sql,params)=>{
   queries.push({sql,params});
   if(sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'||sql==='COMMIT'||
      sql==='ROLLBACK')return {rows:[]};
   if(missing){const e=new Error('missing schema');e.code='42P01';throw e;}
   if(sql.startsWith('SELECT d.id'))return {rows:proposal?[proposal]:[]};
   if(sql.startsWith('SELECT l.position'))return {rows:lines};
   if(sql.startsWith('SELECT id,valid_until'))return {rows:terms?[terms]:[]};
   if(sql.startsWith('SELECT id,sow_revision'))return {rows:sow?[sow]:[]};
   throw new Error('Unexpected query');
  },
  release:()=>{released=true;}
 })};
 return {pool,queries,get released(){return released;}};
}
const priced={position:1,description:'Synthetic scoping review',quantity:1,
 unit_price_minor:'75000',line_total_minor:'75000',
 source_catalog_id:null,source_catalog_revision:null};
test('planning SOW is a scoped read-only snapshot with explicit missing authority',async()=>{
 const m=mock({lines:[priced]});
 const r=await readSowSources(m.pool,id,'ci-owner');
 assert.equal(r.available,true);
 assert.equal(r.proposal_revision,2);
 assert.equal(r.lines[0].provenance,null);
 assert.equal(r.amount_minor,75000);
 assert.equal(r.terms,null);
 assert.equal(r.current_sow,null);
 assert.match(r.blockers.join(' '),/no linked catalog version or current structured SOW/);
 assert.equal(r.contract_checks.length,5);
 assert.equal(r.contract_checks.find(x=>x.code==='nda').status,'applicability_not_assessed');
 assert.equal(r.contract_checks.find(x=>x.code==='dpa').status,'applicability_not_assessed');
 assert.equal(r.contract_checks.find(x=>x.code==='right_to_test').status,'not_authorised');
 assert.equal(r.can_accept_engagement,false);
 assert.equal(r.can_approve_sow,false);
 assert.equal(r.can_sign,false);
 assert.equal(r.testing_authorised,false);
 assert.match(r.blockers.join(' '),/permission.*testing/);
 assert.ok(m.queries[1].sql.includes('enkyron_crm_effective_ticket_links'));
 assert.deepEqual(m.queries[1].params,['local:ci-owner',id]);
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.equal(m.released,true);
 assert.ok(m.queries.every(q=>!/^(?:INSERT|UPDATE|DELETE)/.test(q.sql)));
});
test('exact historical catalog fiche is copied for read-only SOW planning',async()=>{
 const line={...priced,source_catalog_id:id,source_catalog_revision:3,
  service_code:'ARL-TEST',service_name:'Synthetic Agent Assessment',
  inclusions:'Review a bounded synthetic agent workflow in a sandbox.',
  exclusions:'No active customer network testing or credential collection.',
  deliverables:'Written synthetic trust-boundary and risk observations.',
  prerequisites:'A written authorization will be required for any active test.',
  technical_notes:null};
 const terms={id,valid_until:'2099-12-31',still_valid:true,
  payment_terms:'Synthetic manual payment terms only',
  delivery_terms:'Documentary review before any delivery',
  exclusions:'No live penetration testing within this proposal',
  assumptions:'Synthetic scope not authorized for production',
  source_reference:'CI fixture',review_status:'operator_draft_unapproved'};
 const m=mock({proposal:{...fixture,buyer_origin:'crm_company',
   effective_origin:true},lines:[line],terms});
 const r=await readSowSources(m.pool,id,'ci-owner');
 assert.equal(r.lines[0].provenance.source_catalog_revision,3);
 assert.equal(r.lines[0].provenance.deliverables,line.deliverables);
 assert.equal(r.terms.review_status,'operator_draft_unapproved');
 assert.ok(!r.blockers.some(x=>x.includes('No commercial terms')));
 assert.equal(r.can_approve_sow,false);
});
test('stale association, cross-workspace, inconsistent fee and absent schema fail closed',async()=>{
 const revoked=await readSowSources(mock({proposal:{...fixture,buyer_origin:'crm_company',
  effective_origin:false}}).pool,id,'ci-owner');
 assert.match(revoked.blockers.join(' '),/no longer effective/);
 await assert.rejects(()=>readSowSources(mock({proposal:null}).pool,id,'ci-owner'),
  /not found/);
 await assert.rejects(()=>readSowSources(mock({lines:[priced],
   proposal:{...fixture,amount_minor:'76000'}}).pool,id,'ci-owner'),/total/);
 const m=mock({missing:true});
 const unavailable=await readSowSources(m.pool,id,'ci-owner');
 assert.equal(unavailable.available,false);
 assert.equal(m.queries.at(-1).sql,'ROLLBACK');
 await assert.rejects(()=>readSowSources(m.pool,'bad','ci-owner'),/invalid proposal/);
 await assert.rejects(()=>readSowSources(m.pool,id,'bad actor'),/invalid local operator/);
});

test('saved SOW R1 is documented on exact revision, without granting contract authority',async()=>{
 const saved={id,sow_revision:1,status:'operator_draft_unapproved',
   content_sha256:'a'.repeat(64),
   acceptance_criteria:'Written scoping report lists evidence and known limitations.',
   target_inventory:'Documentary inventory only; no host is authorised.'};
 const m=mock({proposal:{...fixture,buyer_origin:'crm_company',effective_origin:true},
   lines:[priced],sow:saved});
 const r=await readSowSources(m.pool,id,'ci-owner');
 assert.equal(r.current_sow.sow_revision,1);
 assert.match(r.blockers.join(' '),/manual correspondence with the unapproved SOW still needs review/);
 assert.ok(!r.blockers.some(x=>x.includes('require manually documented inclusions')));
 assert.equal(r.current_sow.content_sha256,saved.content_sha256);
 assert.equal(r.current_sow.acceptance_criteria,saved.acceptance_criteria);
 assert.ok(!r.blockers.some(x=>x.includes('not separately documented')));
 assert.match(r.blockers.join(' '),/NOT independently approved or accepted/);
 assert.equal(r.contract_checks.find(x=>x.code==='exclusions').status,'draft_only_unapproved');
 assert.equal(r.testing_authorised,false);
 assert.equal(r.can_sign,false);
 const select=m.queries.find(x=>x.sql.startsWith('SELECT id,sow_revision'));
 assert.deepEqual(select.params,['local:ci-owner',id,2]);
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.ok(m.queries.every(x=>!/^(?:INSERT|UPDATE|DELETE)/.test(x.sql)));
});
test('future proposal revision cannot revive the SOW from another revision',async()=>{
 const m=mock({proposal:{...fixture,revision:3},sow:null});
 const r=await readSowSources(m.pool,id,'ci-owner');
 assert.equal(r.current_sow,null);
 assert.ok(r.blockers.some(x=>x.includes('not separately documented')));
 assert.equal(r.contract_checks.find(x=>x.code==='exclusions').status,'sow_not_documented');
 assert.deepEqual(m.queries.find(x=>x.sql.startsWith('SELECT id,sow_revision')).params,
   ['local:ci-owner',id,3]);
});
