import test from 'node:test';
import assert from 'node:assert/strict';
import {readProposalForDraftPdf} from '../desktop/enkyron-crm-proposal-export.mjs';

const id='11111111-2222-4333-8444-555555555555';
function makePool({missing=false,foreign=false,badTotal=false,withLines=true}={}){
  const queries=[];let released=0;
  const proposal={id,opportunity_id:id,title:'Human-led AI security proposal',
    scope_text:'Scope grounded in manual requirements and explicit customer permission.',
    currency:'GBP',amount_minor:50000,revision:2,
    company_name_at_creation:'Unverified research candidate'};
  return {queries,get released(){return released;},pool:{
    connect:async()=>({query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.startsWith('SELECT d.id'))return {rows:foreign?[]:[proposal]};
      if(sql.startsWith('SELECT position')){
        if(missing){const e=new Error('missing migration');e.code='42P01';throw e;}
        return {rows:withLines?[{position:1,description:'Manual tool review',
          quantity:2,unit_price_minor:'25000',
          line_total_minor:badTotal?'50001':'50000'}]:[]};
      }
      return {rows:[]};
    },release:()=>{released++;}})
  }};
}
test('snapshot uses read-only repeatable read and exact workspace scope',async()=>{
  const m=makePool();
  const data=await readProposalForDraftPdf(m.pool,id,'ci-owner');
  assert.equal(data.available,true);
  assert.equal(data.proposal.revision,2);
  assert.equal(data.proposal.amount_minor,50000);
  assert.equal(data.proposal.research_candidate,'Unverified research candidate');
  assert.deepEqual(data.proposal.lines,[{position:1,
    description:'Manual tool review',quantity:2,
    unit_price_minor:25000,line_total_minor:50000}]);
  assert.match(m.queries[0].sql,/REPEATABLE READ READ ONLY/);
  assert.deepEqual(m.queries.slice(1,3).map(x=>x.params),[
    ['local:ci-owner',id],['local:ci-owner',id]
  ]);
  assert.deepEqual(m.queries.map(x=>x.sql.split(' ')[0]),[
    'BEGIN','SELECT','SELECT','COMMIT'
  ]);
  assert.equal(m.released,1);
  assert.doesNotMatch(m.queries.map(x=>x.sql).join(' '),
    /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
});
test('no priced itemization is an honest manual fee, not fabricated lines',async()=>{
  const m=makePool({withLines:false});
  const result=await readProposalForDraftPdf(m.pool,id,'ci-owner');
  assert.deepEqual(result.proposal.lines,[]);
  assert.equal(result.proposal.amount_minor,50000);
});
test('foreign proposal, missing migration and mismatched totals fail closed',async()=>{
  const a=makePool({foreign:true});
  await assert.rejects(()=>readProposalForDraftPdf(a.pool,id,'ci-owner'),/not found/);
  assert.equal(a.queries.at(-1).sql,'ROLLBACK');
  const b=makePool({badTotal:true});
  await assert.rejects(()=>readProposalForDraftPdf(b.pool,id,'ci-owner'),/inconsistent|match/i);
  assert.equal(b.queries.at(-1).sql,'ROLLBACK');
  const c=makePool({missing:true});
  const result=await readProposalForDraftPdf(c.pool,id,'ci-owner');
  assert.equal(result.available,false);
  assert.ok(!result.proposal);
  assert.equal(c.queries.at(-1).sql,'ROLLBACK');
  assert.equal(c.released,1);
  await assert.rejects(()=>readProposalForDraftPdf(a.pool,id,'bad actor'),/operator/);
  await assert.rejects(()=>readProposalForDraftPdf(a.pool,'bad','ci-owner'),/identifier/);
});
