import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProposalLines,readProposalLines,replaceProposalLines}
  from '../desktop/enkyron-crm-proposal-lines.mjs';
const id='11111111-2222-4333-8444-555555555555';
const req={proposal_id:id,expected_revision:2,lines:[
  {description:'AI tool inventory and scoping',quantity:2,unit_price_minor:125050},
  {description:'Human-led evidence review',quantity:1,unit_price_minor:99999}
]};
test('exact minor-unit line totals and strict bounds',()=>{
  const r=validateProposalLines(req);
  assert.equal(r.total_minor,350099);
  assert.equal(r.lines[0].line_total_minor,250100);
  for(const bad of [
    {...req,lines:[]},{...req,lines:Array(26).fill(req.lines[0])},
    {...req,lines:[{...req.lines[0],quantity:0}]},
    {...req,lines:[{...req.lines[0],quantity:10001}]},
    {...req,lines:[{...req.lines[0],quantity:1.5}]},
    {...req,lines:[{...req.lines[0],unit_price_minor:'125050'}]},
    {...req,lines:[{...req.lines[0],description:'bad'}]},
    {...req,lines:[{...req.lines[0],description:'Invalid\nservice'}]},
    {...req,lines:[{...req.lines[0],quantity:10000,unit_price_minor:999999999}]},
    {...req,expected_revision:0},{...req,proposal_id:'bad'}
  ])assert.throws(()=>validateProposalLines(bad),/CRM/);
});
test('read-only scope and accurate persisted line reconciliation',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[{
      id,revision:2,amount_minor:'350099',currency:'GBP',title:'Synthetic consulting proposal',
      description:'AI tool inventory and scoping',
      quantity:2,unit_price_minor:'125050',line_total_minor:'250100',position:1
    },{
      id,revision:2,amount_minor:'350099',currency:'GBP',title:'Synthetic consulting proposal',
      description:'Human-led evidence review',
      quantity:1,unit_price_minor:'99999',line_total_minor:'99999',position:2
    }]};
  }};
  const data=await readProposalLines(db,id,'ci-owner');
  assert.equal(data.uses_lines,true);
  assert.equal(data.lines.length,2);
  assert.equal(data.amount_minor,350099);
  assert.equal(data.title,'Synthetic consulting proposal');
  assert.deepEqual(calls[0].params,['local:ci-owner',id]);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE)\b/i);
  await assert.rejects(()=>readProposalLines({
    query:async()=>({rows:[]})
  },id,'ci-owner'),/not found/);
});
test('replacement changes total and appends immutable detail and audit metadata',async()=>{
  const queries=[];let released=0,number=0;
  const db={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.startsWith('SELECT id,title,scope_text'))return {rows:[{
        id,title:'Test proposal',scope_text:'Detailed test proposal scope',
        currency:'GBP',revision:2
      }]};
      if(sql.startsWith('SELECT description,quantity'))return {rows:[]};
      if(sql.startsWith('UPDATE'))return {rows:[{revision:3}]};
      return {rows:[]};
    },
    release:()=>{released++;}
  })};
  const r=await replaceProposalLines(db,req,'ci-owner',{
    uuid:()=>'00000000-0000-4000-8000-'+String(++number).padStart(12,'0')
  });
  assert.equal(r.total_minor,350099);
  assert.equal(r.revision,3);
  assert.equal(queries[0].sql,'BEGIN');
  assert.equal(queries.at(-1).sql,'COMMIT');
  assert.equal(queries.filter(q=>q.sql.startsWith('INSERT INTO enkyron_crm_proposal_lines')).length,2);
  assert.equal(queries.filter(q=>q.sql.startsWith('INSERT INTO enkyron_crm_proposal_line_versions')).length,2);
  const update=queries.find(q=>q.sql.startsWith('UPDATE'));
  assert.equal(update.params[2],350099);
  assert.equal(update.params[3],3);
  assert.equal(update.params[5],2);
  const audit=queries.find(q=>q.sql.startsWith('INSERT INTO enkyron_crm_proposal_draft_events'));
  assert.match(audit.params[4],/^[a-f0-9]{64}$/);
  assert.deepEqual(queries.find(q=>q.sql.startsWith('SELECT id,title')).params,
    ['local:ci-owner',id]);
  assert.equal(released,1);
});
test('stale versions and foreign workspace reject before any writes',async()=>{
  for(const mode of ['missing','stale']){
    const statements=[];
    const db={connect:async()=>({
      query:async(sql)=>{
        statements.push(sql);
        if(sql.startsWith('SELECT id,title,scope_text'))
          return {rows:mode==='missing'?[]:[{id,revision:3}]};
        return {rows:[]};
      },release:()=>{}
    })};
    await assert.rejects(()=>replaceProposalLines(db,req,'ci-owner'),/CRM proposal/);
    assert.equal(statements.at(-1),'ROLLBACK');
    assert.ok(!statements.some(s=>s.startsWith('INSERT')||s.startsWith('DELETE')));
  }
});

test('unitemized draft exposes its saved title and exact fee for safe editable prefill',async()=>{
  const source={query:async()=>({rows:[{
    id,revision:1,title:'AI Agent Security Scoping Review — DRAFT',
    amount_minor:'75000',currency:'GBP',position:null,
    description:null,quantity:null,unit_price_minor:null,line_total_minor:null
  }]})};
  const r=await readProposalLines(source,id,'ci-owner');
  assert.equal(r.uses_lines,false);
  assert.equal(r.title,'AI Agent Security Scoping Review — DRAFT');
  assert.equal(r.amount_minor,75000);
  assert.deepEqual(r.lines,[]);
});
