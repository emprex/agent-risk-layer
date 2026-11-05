import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPPORTUNITY_STAGES,validateOpportunityCreate,validateOpportunityUpdate,
  listOpportunities,prospectOpportunity,createOpportunity,updateOpportunity
} from '../desktop/enkyron-crm-opportunities.mjs';
const id='11111111-2222-4333-8444-555555555555';
const base={prospect_id:'lead_synthetic',company_name_at_review:'Acme Research',
  next_action:'Review public contact details before any outreach',due_date:'2026-11-12'};
const edit={id,expected_version:1,stage:'qualified',
  next_action:'Prepare a tailored introduction for human approval',
  due_date:null};
test('validates business stages, actual calendar dates and manual action',()=>{
  assert.equal(OPPORTUNITY_STAGES.length,9);
  assert.deepEqual(validateOpportunityCreate(base),base);
  for(const invalid of [
    {...base,prospect_id:''},
    {...base,company_name_at_review:' '},
    {...base,next_action:'x'},
    {...base,due_date:'2026-02-30'},
    {...base,due_date:'2026-13-01'},
    {...base,due_date:'next week'},
    {...base,next_action:'Line\nBreak'},
    null,{},[]
  ]) assert.throws(()=>validateOpportunityCreate(invalid),/CRM/);
  assert.equal(validateOpportunityUpdate(edit).stage,'qualified');
  for(const invalid of [
    {...edit,id:'nonsense'},{...edit,expected_version:0},
    {...edit,expected_version:'1'},{...edit,stage:'autoprospect'},
    {...edit,next_action:''},{...edit,due_date:'2026-11-31'},null,[]
  ]) assert.throws(()=>validateOpportunityUpdate(invalid),/CRM/);
});

test('local read operations are bounded, scoped and cannot send email',async()=>{
  const calls=[];
  const db={query:async(sql,values)=>{
    calls.push({sql,values});
    return {rows:[]};
  }};
  const result=await listOpportunities(db,'  Acme  ','ci-operator');
  assert.equal(result.available,true);
  assert.deepEqual(calls[0].values,['local:ci-operator','Acme']);
  assert.match(calls[0].sql,/LIMIT 101/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|MERGE)\s/i);
  assert.ok(!/send|smtp|gmail/i.test(calls[0].sql));
  const existing=await prospectOpportunity(db,'lead_synthetic','ci-operator');
  assert.equal(existing.opportunity,null);
  assert.deepEqual(calls[1].values,['local:ci-operator','lead_synthetic']);
  await assert.rejects(()=>listOpportunities(db,'x'.repeat(101),'ci-operator'),/100 characters/);
  const missing={query:async()=>{const e=new Error('missing');e.code='42P01';throw e;}};
  assert.equal((await listOpportunities(missing,'','ci-operator')).available,false);
  assert.equal((await prospectOpportunity(missing,'lead_synthetic','ci-operator')).available,false);
});

test('creation records opportunity and append-only event in one transaction',async()=>{
  const calls=[];
  const client={
    query:async(sql,values)=>{
      calls.push({sql,values});
      if(sql.includes('FROM sales_prospects'))return {rows:[{id:'lead_synthetic',company_name:'Acme Research'}]};
      return {rows:[]};
    },
    release:()=>calls.push({sql:'RELEASE'})
  };
  const ids=[id,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
  const res=await createOpportunity({connect:async()=>client},base,'ci-operator',{uuid:()=>ids.shift()});
  assert.deepEqual(res,{id,prospect_id:'lead_synthetic',stage:'research',version:1});
  assert.equal(calls[0].sql,'BEGIN');
  assert.equal(calls.at(-2).sql,'COMMIT');
  assert.equal(calls.at(-1).sql,'RELEASE');
  assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_crm_opportunities ')));
  assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_crm_opportunity_events ')));
  assert.ok(!calls.some(x=>/UPDATE sales_prospects|INSERT INTO sales_messages/i.test(x.sql)));
});

test('changing source identity aborts before insert',async()=>{
  const sqls=[];
  await assert.rejects(()=>createOpportunity({
    connect:async()=>({
      query:async(sql)=>{
        sqls.push(sql);
        return {rows:sql.includes('FROM sales_prospects')?
          [{id:'lead_synthetic',company_name:'Different company'}]:[]};
      },release:()=>{}
    })
  },base,'ci-operator'),/name changed/);
  assert.equal(sqls.at(-1),'ROLLBACK');
  assert.ok(!sqls.some(sql=>sql.startsWith('INSERT')));
});

test('update checks expected version and audits old/new fields atomically',async()=>{
  const calls=[];
  const client={query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT id,stage,next_action'))return {rows:[{
      id,stage:'research',next_action:'Original action',due_date:null,version:1
    }]};
    if(sql.startsWith('UPDATE enkyron_crm_opportunities'))return {rows:[{id,version:2}]};
    return {rows:[]};
  },release:()=>{}};
  const result=await updateOpportunity({connect:async()=>client},edit,'ci-operator',
    {uuid:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});
  assert.equal(result.version,2);
  assert.equal(result.stage,'qualified');
  assert.equal(calls.at(-1).sql,'COMMIT');
  const update=calls.find(x=>x.sql.startsWith('UPDATE enkyron_crm_opportunities'));
  assert.deepEqual(update.values.slice(0,2),['local:ci-operator',id]);
  assert.equal(update.values[5],1);
  const event=calls.find(x=>x.sql.startsWith('INSERT INTO enkyron_crm_opportunity_events'));
  assert.equal(event.values[3],'research');
  assert.equal(event.values[4],'qualified');
  const actions=[];
  await assert.rejects(()=>updateOpportunity({
    connect:async()=>({
      query:async(sql)=>{
        actions.push(sql);
        if(sql.startsWith('SELECT id,stage,next_action'))return {rows:[{
          id,stage:'research',next_action:'Original action',due_date:null,version:2
        }]};
        return {rows:[]};
      },release:()=>{}
    })
  },edit,'ci-operator'),/changed since opening/);
  assert.equal(actions.at(-1),'ROLLBACK');
});
