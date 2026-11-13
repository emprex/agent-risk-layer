import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_TYPES,validateActivity,requireOpportunityId,
  listActivityTimeline,recordActivity
} from '../desktop/enkyron-crm-activities.mjs';
const opportunityId='11111111-2222-4333-8444-555555555555';
const companyId='22222222-3333-4444-8555-666666666666';
const input={opportunity_id:opportunityId,activity_type:'call_note',
  detail:'Reviewed prospect background before calling; no outcome verified.',
  reviewed:true};

test('rejects malformed and unconfirmed activity, permits multiline notes',()=>{
  assert.equal(ACTIVITY_TYPES.length,5);
  assert.equal(validateActivity(input).activity_type,'call_note');
  assert.equal(validateActivity({...input,detail:'First step\nSecond step.'}).detail,
    'First step\nSecond step.');
  assert.equal(validateActivity({
    company_id:companyId,activity_type:'note',detail:'Research collected from public sources.',
    reviewed:true
  }).company_id,companyId);
  for(const bad of [
    {...input,company_id:companyId},
    {...input,opportunity_id:null},
    {...input,opportunity_id:'wrong'},
    {...input,activity_type:'send_email'},
    {...input,detail:'short'},
    {...input,detail:'a'.repeat(2001)},
    {...input,detail:'invalid\u0000detail'},
    {...input,reviewed:false},
    {...input,reviewed:undefined},null,[],{}
  ])assert.throws(()=>validateActivity(bad),/CRM/);
  assert.throws(()=>requireOpportunityId("x' OR true"),/CRM/);
});

test('read scoped opportunity, combine history with bounded query',async()=>{
  const seen=[];
  const db={query:async(sql,params)=>{
    seen.push({sql,params});
    if(sql.includes('SELECT id,prospect_id'))return {rows:[{
      id:opportunityId,company_id:companyId,company_name_at_creation:'Synthetic',
      stage:'qualified',next_action:'Review agreed next step',due_date:'2026-11-20',
      probability_percent:35,owner_local:'ci-operator',version:2
    }]};
    return {rows:[
      {id:'activity',entry_kind:'activity',detail:'Manual call note'},
      {id:'change',entry_kind:'change',event_type:'updated'}
    ]};
  }};
  const output=await listActivityTimeline(db,opportunityId,'ci-operator');
  assert.equal(output.available,true);
  assert.equal(output.items.length,2);
  assert.equal(output.opportunity.company_id,companyId);
  assert.equal(output.opportunity.version,2);
  assert.equal(output.opportunity.next_action,'Review agreed next step');
  assert.match(seen[0].sql,/company_id,company_name_at_creation,stage,next_action,due_date,probability_percent,owner_local,version/);
  // Database returns newest first; the CRM presents the story oldest first.
  assert.deepEqual(output.items.map(entry=>entry.id),['change','activity']);
  assert.deepEqual(seen.map(c=>c.params),
    [['local:ci-operator',opportunityId],['local:ci-operator',opportunityId]]);
  assert.match(seen[1].sql,/UNION ALL/);
  assert.match(seen[1].sql,/LIMIT 101/);
  assert.ok(seen.every(c=>!/\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/.test(c.sql)));
  await assert.rejects(()=>listActivityTimeline({query:async()=>({rows:[]})},
    opportunityId,'ci-operator'),/not found/);
  const missing={query:async()=>{const error=new Error('missing');error.code='42P01';throw error;}};
  assert.equal((await listActivityTimeline(missing,opportunityId,'ci-operator')).available,false);
});

test('atomic activity insert under workspace, no source or email modification',async()=>{
  const queries=[];
  let releaseCount=0;
  const client={
    query:async(sql,values)=>{
      queries.push({sql,values});
      return {rows:sql.includes('FROM enkyron_crm_opportunities')?[{id:opportunityId}]:[]};
    },
    release:()=>{releaseCount++;}
  };
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const out=await recordActivity({connect:async()=>client},input,'ci-operator',{uuid:()=>id});
  assert.equal(out.id,id);
  assert.equal(out.activity_type,'call_note');
  assert.deepEqual(queries.map(c=>c.sql.match(/^[A-Z]+/)[0]),
    ['BEGIN','SELECT','INSERT','COMMIT']);
  assert.deepEqual(queries[1].values,['local:ci-operator',opportunityId]);
  assert.deepEqual(queries[2].values,
    [id,'local:ci-operator',opportunityId,null,'call_note',input.detail,'ci-operator']);
  assert.equal(releaseCount,1);
  assert.ok(!queries.some(c=>/INSERT INTO sales_messages|UPDATE sales_prospects/i.test(c.sql)));
});

test('cross-workspace or missing opportunity rolls back without inserting note',async()=>{
  const queries=[];
  let released=false;
  const db={connect:async()=>({
    query:async(sql)=>{
      queries.push(sql);
      return {rows:[]};
    },release:()=>{released=true;}
  })};
  await assert.rejects(
    ()=>recordActivity(db,input,'different-operator'),
    /opportunity not found/
  );
  assert.deepEqual(queries,[
    'BEGIN',
    'SELECT id FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
    'ROLLBACK'
  ]);
  assert.equal(released,true);
});
