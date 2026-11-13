import test from 'node:test';
import assert from 'node:assert/strict';
import { listSalesProspects, listSalesProspectsPage, validateProspectPage } from '../desktop/enkyron-crm-prospects.mjs';

test('read-only pages return exactly one chunk and a stable total', async()=>{
  const seen=[];
  const rows=Array.from({length:100},(_,i)=>({
    id:'ARL-P-'+String(i).padStart(6,'0'),
    company_name:'Company '+i,
    buyer_name:null,stage:'research',source:'synthetic-ci'
  }));
  const pool={query:async(sql,params)=>{
    seen.push({sql,params});
    return {rows:[{total:344,items:rows}]};
  }};
  const data=await listSalesProspectsPage(pool,{search:'  Example  ',page:2});
  assert.equal(data.available,true);
  assert.equal(data.kind,'unverified_sales_prospects');
  assert.equal(data.total,344);
  assert.equal(data.page,2);
  assert.equal(data.page_size,100);
  assert.equal(data.items.length,100);
  assert.equal(data.more,true);
  assert.deepEqual(seen[0].params,['Example',100]);
  assert.match(seen[0].sql,/LIMIT 100 OFFSET \$2/);
  assert.match(seen[0].sql,/COUNT\(\*\)::integer/);
  assert.match(seen[0].sql,/ORDER BY updated_at DESC, id/);
  assert.match(seen[0].sql,/^WITH filtered AS/);
  assert.doesNotMatch(seen[0].sql,/\b(?:INSERT|UPDATE|DELETE|MERGE)\s/i);
  const fourth=await listSalesProspectsPage(pool,{search:'Example',page:4});
  assert.deepEqual(seen[1].params,['Example',300]);
  assert.equal(fourth.more,false);
});

test('search is bounded and page cannot inject SQL or overflow',async()=>{
  for(const value of [0,-1,1.5,10001,'2',NaN,null,{},Infinity]){
    assert.throws(()=>validateProspectPage({search:'a',page:value}),/CRM page/);
  }
  assert.throws(()=>validateProspectPage({search:'x'.repeat(101),page:1}),/100 characters/);
  assert.throws(()=>validateProspectPage({page:1}),/Search/);
  assert.throws(()=>validateProspectPage(null),/CRM/);
  let values;
  const pool={query:async(sql,params)=>{values=params;return {rows:[{total:0,items:[]}]} }};
  const candidate="O'Reilly_%";
  assert.equal((await listSalesProspects(pool,candidate)).items.length,0);
  assert.deepEqual(values,[candidate,0]);
});

test('page four ends at 344 without modifying the source',async()=>{
  const pool={query:async()=>({rows:[{
    total:344,
    items:Array.from({length:44},(_,i)=>({id:'P'+(301+i)}))
  }]})};
  const data=await listSalesProspectsPage(pool,{search:'',page:4});
  assert.equal(data.items.length,44);
  assert.equal(data.total,344);
  assert.equal(data.more,false);
});

test('absent table is explicit and unrelated SQL errors propagate',async()=>{
  const missing=await listSalesProspectsPage({
    query:async()=>{const error=new Error('not found');error.code='42P01';throw error;}
  },{search:'',page:1});
  assert.equal(missing.available,false);
  assert.equal(missing.total,0);
  assert.deepEqual(missing.items,[]);
  assert.match(missing.notice,/not installed/);
  await assert.rejects(()=>listSalesProspectsPage({
    query:async()=>{throw new Error('access denied');}
  },{search:'',page:1}),/access denied/);
});
