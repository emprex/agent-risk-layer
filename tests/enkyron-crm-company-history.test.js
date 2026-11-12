import test from 'node:test';
import assert from 'node:assert/strict';
import {getCompanyHistoryPage,COMPANY_HISTORY_SQL}
  from '../desktop/enkyron-crm-company-history.mjs';

const company='11111111-2222-4333-8444-555555555555';
const company2='22222222-3333-4444-8555-666666666666';

function fakeDb(){
  const queries=[];
  let released=0;
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.startsWith('SELECT id FROM enkyron_crm_companies')) {
        return {rows:params[1]===company?[{id:company}]:[]};
      }
      if(sql.startsWith('WITH linked_opportunities AS')) {
        return {rows:[{
          event_id:'event-1',resource_kind:'opportunity',resource_id:'op-1',
          action:'created',actor_local:'ci',
          summary:'A fully recorded business action.',recorded_at:'2026-11-12T18:10:00Z',
          total_rows:'43'
        }]};
      }
      return {rows:[]};
    },release:()=>{released++;}
  })};
  return {pool,queries,released:()=>released};
}

test('chronological reader is exact-ID, read-only and bounded in both sort orders',async()=>{
  assert.doesNotMatch(COMPANY_HISTORY_SQL,/left\(e\.new_(?:next_action|action_text),180\)/);
  const d=fakeDb();
  for(const order of ['oldest','newest']){
    const result=await getCompanyHistoryPage(d.pool,{
      company_id:company,page:1,order
    },'ci-operator');
    assert.equal(result.order,order);
    assert.equal(result.page,1);
    assert.equal(result.total,43);
    assert.equal(result.more,true);
    assert.equal(result.items[0].summary,'A fully recorded business action.');
  }
  const pages=d.queries.filter(q=>q.sql.startsWith('WITH linked_opportunities AS'));
  assert.equal(pages.length,2);
  assert.match(pages[0].sql,/ORDER BY recorded_at ASC,event_id ASC/);
  assert.match(pages[1].sql,/ORDER BY recorded_at DESC,event_id DESC/);
  assert.deepEqual(pages[0].params,['local:ci-operator',company,20]);
  assert.deepEqual(pages[1].params,['local:ci-operator',company,20]);
  assert.equal(d.queries.filter(q=>/BEGIN/.test(q.sql)).length,2);
  assert.equal(d.queries.filter(q=>q.sql==='COMMIT').length,2);
  assert.equal(d.released(),2);
  for(const q of d.queries){
    assert.doesNotMatch(q.sql,/INSERT INTO|UPDATE\s+enkyron_|DELETE FROM/);
  }
});
test('invalid paging, wrong local operator and other company fail closed',async()=>{
  const d=fakeDb();
  for(const payload of [
    {company_id:company,page:-1,order:'oldest'},
    {company_id:company,page:10001,order:'oldest'},
    {company_id:company,page:'0',order:'oldest'},
    {company_id:company,page:0,order:'invalid'},
    {company_id:'missing',page:0,order:'newest'}
  ])await assert.rejects(()=>getCompanyHistoryPage(d.pool,payload,'ci-operator'));
  assert.equal(d.queries.length,0);
  await assert.rejects(()=>getCompanyHistoryPage(d.pool,{
    company_id:company2,page:0,order:'oldest'
  },'ci-operator'),/not found in local workspace/);
  assert.equal(d.queries.at(-1).sql,'ROLLBACK');
  assert.equal(d.released(),1);
});
