import test from 'node:test';
import assert from 'node:assert/strict';
import {PIPELINE_LANES,pipelineLane,getSalesPipeline}
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
      {id,prospect_id:'lead_ci',company_name_at_creation:'Synthetic',
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
