import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES,validateProposalCreate,validateProposalUpdate,
  listProposalDrafts,readProposalDraft,createProposalDraft,updateProposalDraft
} from '../desktop/enkyron-crm-proposals.mjs';
const opportunity='11111111-2222-4333-8444-555555555555';
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base={
  opportunity_id:opportunity,title:'Commercial security proposal',
  scope_text:'Manual exploratory review of specified agent tools and workflows.',
  currency:'GBP',amount_minor:125050
};
test('manual fee is exact integer minor units; never infer VAT or customer validation',()=>{
  assert.deepEqual(CURRENCIES,['GBP','EUR','USD']);
  assert.equal(validateProposalCreate(base).amount_minor,125050);
  assert.equal(validateProposalUpdate({
    ...base,id,expected_revision:2
  }).expected_revision,2);
  for(const invalid of [
    null,{},[],{...base,opportunity_id:'other'},
    {...base,title:'bad'}, {...base,title:'x'.repeat(161)},
    {...base,title:'test\nBcc:'}, {...base,scope_text:'short'},
    {...base,scope_text:'x'.repeat(5001)},
    {...base,currency:'AUTO'}, {...base,amount_minor:0},
    {...base,amount_minor:1.5},{...base,amount_minor:'125050'},
    {...base,amount_minor:1000000000}
  ])assert.throws(()=>validateProposalCreate(invalid),/CRM/);
  for(const invalid of [
    {...base,id:'bad',expected_revision:1},
    {...base,id,expected_revision:0},
    {...base,id,expected_revision:'1'}
  ])assert.throws(()=>validateProposalUpdate(invalid),/CRM/);
});
test('list is bounded and private scope; detail fetch is scoped and contains body',async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('d.scope_text'))return {rows:[{
      id,title:base.title,scope_text:base.scope_text,amount_minor:'125050',
      revision:1
    }]};
    return {rows:[]};
  }};
  const list=await listProposalDrafts(db,' security ','ci-owner');
  assert.equal(list.available,true);
  assert.equal(list.more,false);
  assert.ok(!queries[0].sql.includes('d.scope_text'));
  assert.match(queries[0].sql,/LIMIT 101/);
  assert.deepEqual(queries[0].params,['local:ci-owner','security']);
  const read=await readProposalDraft(db,id,'ci-owner');
  assert.equal(read.proposal.scope_text,base.scope_text);
  assert.deepEqual(queries[1].params,['local:ci-owner',id]);
  await assert.rejects(()=>readProposalDraft(db,'x','ci-owner'),/invalid/);
  const missing={query:async()=>{
    const e=new Error('not installed');e.code='42P01';throw e;
  }};
  assert.equal((await listProposalDrafts(missing,'','ci-owner')).available,false);
  assert.equal((await readProposalDraft(missing,id,'ci-owner')).available,false);
});
test('create is atomic and writes only draft and hash metadata',async()=>{
  const queries=[];let released=0;
  const ids=[id,'bbbbbbbb-1111-4222-8333-444444444444'];
  const db={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      return {rows:sql.includes('FROM enkyron_crm_opportunities')?[{id:opportunity}]:[]};
    },release:()=>{released++;}
  })};
  const value=await createProposalDraft(db,base,'ci-owner',{uuid:()=>ids.shift()});
  assert.equal(value.id,id);
  assert.equal(value.revision,1);
  assert.deepEqual(queries.map(x=>x.sql.match(/^[A-Z]+/)[0]),[
    'BEGIN','SELECT','INSERT','INSERT','COMMIT'
  ]);
  assert.deepEqual(queries[1].params,['local:ci-owner',opportunity]);
  assert.equal(queries[2].params[6],125050);
  assert.match(queries[3].params[3],/^[a-f0-9]{64}$/);
  assert.ok(!queries[3].params.includes(base.scope_text));
  assert.equal(released,1);
});
test('cross workspace rejects draft creation, no insert; stale edits rollback',async()=>{
  for(const task of ['missing parent','stale edit','unchanged edit']){
    const statements=[];
    const db={connect:async()=>({
      query:async(sql,params)=>{
        statements.push(sql);
        if(sql.startsWith('SELECT title,scope_text')){
          return {rows:[{
            title:base.title,scope_text:base.scope_text,
            currency:'GBP',amount_minor:'125050',
            revision:task==='stale edit'?2:1
          }]};
        }
        return {rows:[]};
      },release:()=>{}
    })};
    if(task==='missing parent')await assert.rejects(
      ()=>createProposalDraft(db,base,'ci-other'),/opportunity not found/
    );else await assert.rejects(()=>updateProposalDraft(db,{
      id,expected_revision:1,title:base.title,
      scope_text:base.scope_text,currency:base.currency,amount_minor:base.amount_minor
    },'ci-owner'),/CRM proposal/);
    assert.equal(statements.at(-1),'ROLLBACK');
    assert.ok(!statements.some(x=>x.startsWith('INSERT')||x.startsWith('UPDATE')));
  }
});
test('edits update price and append new immutable revision fingerprint',async()=>{
  const statements=[];
  const db={connect:async()=>({
    query:async(sql,params)=>{
      statements.push({sql,params});
      if(sql.startsWith('SELECT title,scope_text'))return {rows:[{
        title:base.title,scope_text:base.scope_text,currency:'GBP',
        amount_minor:'125050',revision:1
      }]};
      if(sql.startsWith('UPDATE'))return {rows:[{revision:2}]};
      return {rows:[]};
    },release:()=>{}
  })};
  const next={id,expected_revision:1,
    ...base,title:'Revised manual commercial scope',amount_minor:130055};
  const updated=await updateProposalDraft(db,next,'ci-owner',{
    uuid:()=> 'cccccccc-1111-4222-8333-444444444444'
  });
  assert.equal(updated.revision,2);
  assert.deepEqual(statements.map(x=>x.sql.match(/^[A-Z]+/)[0]),[
    'BEGIN','SELECT','SELECT','UPDATE','INSERT','COMMIT'
  ]);
  assert.equal(statements[3].params[5],130055);
  assert.equal(statements[3].params[8],1);
  assert.match(statements[4].params[4],/^[a-f0-9]{64}$/);
  assert.ok(!statements[4].params.includes(next.scope_text));
});
