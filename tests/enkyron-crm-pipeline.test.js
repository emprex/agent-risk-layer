import test from 'node:test';
import assert from 'node:assert/strict';
import {PIPELINE_LANES,pipelineLane,getSalesPipeline,getSalesPipelinePage,validatePipelinePageRequest}
  from '../desktop/enkyron-crm-pipeline.mjs';
const id='11111111-2222-4333-8444-555555555555';
test('nine existing commercial stages map to five readable pipeline lanes',()=>{
  assert.deepEqual(PIPELINE_LANES.map(l=>l.id),
    ['prospecting','engagement','proposal','won','lost']);
  for(const [stage,lane] of [
    ['research','prospecting'],['qualified','prospecting'],
    ['contact_planned','engagement'],['contacted','engagement'],
    ['discovery','engagement'],['proposal','proposal'],
    ['negotiation','proposal'],['won','won'],['lost','lost']
  ])assert.equal(pipelineLane(stage),lane);
  assert.throws(()=>pipelineLane('automatic_payment'),/CRM unknown/);
});
test('read-only local query delivers accurate stage counts and limited previews',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[
      {id,prospect_id:null,company_id:'33333333-4444-4555-8666-777777777777',
        owner_local:'ci-operator',company_name_at_creation:'Synthetic',
        stage:'research',lane:'prospecting',next_action:'Manual review',
        due_date:null,probability_percent:35,version:2,lane_total:31},
      {id:'22222222-3333-4444-8555-666666666666',prospect_id:'lead_two',
        company_name_at_creation:'Other',stage:'won',lane:'won',
        next_action:'Contract recorded',due_date:null,version:3,lane_total:1}
    ]};
  }};
  const v=await getSalesPipeline(db,'ci-operator');
  assert.equal(v.available,true);
  assert.equal(v.lanes.length,5);
  assert.equal(v.total,32);
  assert.equal(v.lanes[0].total,31);
  assert.equal(v.lanes[0].items[0].probability_percent,35);
  assert.equal(v.lanes[0].items[0].company_id,'33333333-4444-4555-8666-777777777777');
  assert.equal(v.lanes[0].items[0].owner_local,'ci-operator');
  assert.match(calls[0].sql,/company_id,owner_local/);
  assert.match(calls[0].sql,/probability_percent/);
  assert.equal(v.lanes[0].more,true);
  assert.equal(v.lanes[3].items[0].stage,'won');
  assert.equal(v.lanes[2].total,0);
  assert.equal(v.preview_per_lane,30);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].params,['local:ci-operator']);
  assert.match(calls[0].sql,/row_number\(\) OVER/);
  assert.match(calls[0].sql,/PARTITION BY lane/);
  assert.match(calls[0].sql,/lane_rank <= 30/);
  assert.match(calls[0].sql,/workspace_key=\$1/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
});
test('invalid snapshot, duplicate IDs or incorrect stages are rejected',async()=>{
  const good={id,prospect_id:'lead_ci',stage:'research',lane:'prospecting',
    lane_total:1};
  for(const records of [
    [{...good,lane:'lost'}],
    [good,good],
    [{...good,lane_total:-1}],
    [{...good,stage:'invalid'}],
    [{...good,lane:'nonexistent'}]
  ]){
    await assert.rejects(()=>getSalesPipeline({
      query:async()=>({rows:records})
    },'operator'),/CRM/);
  }
  await assert.rejects(()=>getSalesPipeline({query:async()=>({rows:[]})},
    'invalid user name'),/CRM/);
});
test('missing migration reports unavailable, not a fake empty pipeline',async()=>{
  const value=await getSalesPipeline({query:async()=>{
    const e=new Error('missing');e.code='42P01';throw e;
  }},'operator');
  assert.equal(value.available,false);
  assert.match(value.notice,/not available/);
});

test('server-side pagination exposes 300+ engagement records without 30-row preview truncation',async()=>{
  const queries=[];
  const rows=Array.from({length:25},(_,i)=>({
    id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
    prospect_id:'ARL-P-'+String(i+1).padStart(6,'0'),
    company_name_at_creation:'Company '+String(i+1),
    stage:'contacted',lane:'engagement',next_action:'Contact prospect',
    version:1,updated_at:'2026-11-14',due_date:null
  }));
  const pool={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('GROUP BY stage'))return {rows:[
      {stage:'research',total:50},{stage:'contacted',total:300},
      {stage:'proposal',total:250},{stage:'lost',total:25},
      {stage:'won',total:400}
    ]};
    if(sql.includes('count(*)::integer AS total FROM scoped'))return {rows:[{total:300}]};
    return {rows};
  }};
  const input={lane:'engagement',page:12,search:'Company',sort:'due'};
  const data=await getSalesPipelinePage(pool,input,'emprex');
  assert.equal(data.available,true);
  assert.equal(data.overall_total,1025);
  assert.equal(data.total,300);
  assert.equal(data.total_pages,12);
  assert.equal(data.page,12);
  assert.equal(data.items.length,25);
  assert.deepEqual(data.lanes.map(x=>x.total),[50,300,250,400,25]);
  assert.deepEqual(queries[0].params,['local:emprex']);
  assert.deepEqual(queries[1].params,['local:emprex','engagement','Company']);
  assert.deepEqual(queries[2].params,['local:emprex','engagement','Company',25,275]);
  assert.match(queries[2].sql,/ORDER BY due_date ASC NULLS LAST/);
  assert.match(queries[2].sql,/LIMIT \$4 OFFSET \$5/);
  assert.ok(queries.every(x=>! /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(x.sql)));
});
test('pipeline paging validates filter sort size and rejects bad scopes',async()=>{
  assert.deepEqual(validatePipelinePageRequest({}),{
    lane:'all',page:1,search:'',sort:'updated'
  });
  for(const bad of [
    null,[],{lane:'unknown'},{page:0},{page:10001},
    {page:1.5},{search:'x'.repeat(101)},{search:'evil\nvalue'},
    {sort:';DROP TABLE'},{extra:'unused'}
  ])assert.throws(()=>validatePipelinePageRequest(bad),/CRM/);
  await assert.rejects(()=>getSalesPipelinePage({query:async()=>({rows:[]})},
    {},'bad operator name'),/CRM/);
  const unavailable=await getSalesPipelinePage({query:async()=>{
    const e=new Error('missing');e.code='42P01';throw e;
  }},{lane:'all',page:1,search:'',sort:'updated'},'emprex');
  assert.equal(unavailable.available,false);
});
