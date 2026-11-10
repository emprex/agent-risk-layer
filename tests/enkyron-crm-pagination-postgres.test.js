import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {listSalesProspectsPage} from '../desktop/enkyron-crm-prospects.mjs';

const connectionString=process.env.ARL_CI_POSTGRES_URL||'';
function safeDatabase(){
  assert.equal(process.env.CI,'true','Only dedicated ephemeral CI database can be written');
  const url=new URL(connectionString);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.pathname,'/arl_ci');
  assert.equal(url.username,'arl_ci');
  assert.equal(url.password,'synthetic-ci-only');
  return connectionString;
}
test('344 synthetic research candidates appear on pages 1, 2, 3 and 4 without duplicates', {
  skip:!connectionString&&'Only disposable CI PostgreSQL database',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:safeDatabase(),max:2});
  try{
    await pool.query(
      'INSERT INTO users (id,email,password_hash,created_at) VALUES($1,$2,$3,$4)',
      ['user_crm_pagination_ci','crm-pagination@example.invalid','synthetic-ci-only',
       new Date().toISOString()]
    );
    const values=[],placeholders=[];
    const prefix='CRM-PAGE-CI-';
    const now=new Date().toISOString();
    for(let i=1;i<=344;i++){
      const pos=values.length;
      const id='crm_page_ci_'+String(i).padStart(4,'0');
      values.push(id,prefix+String(i).padStart(4,'0'),'user_crm_pagination_ci',
        'synthetic-ci',now,now);
      placeholders.push('('+
        Array.from({length:6},(_,k)=>'$'+(pos+k+1)).join(',')+')');
    }
    await pool.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,created_by,source,created_at,updated_at) VALUES '
      +placeholders.join(','),values
    );
    const seen=new Set(),lengths=[];
    for(let page=1;page<=4;page++){
      const response=await listSalesProspectsPage(pool,{search:prefix,page});
      assert.equal(response.available,true);
      assert.equal(response.total,344);
      assert.equal(response.page,page);
      assert.equal(response.page_size,100);
      assert.equal(response.more,page<4);
      lengths.push(response.items.length);
      for(const row of response.items){
        assert.ok(!seen.has(row.id),'duplicate id across pages');
        seen.add(row.id);
      }
    }
    assert.deepEqual(lengths,[100,100,100,44]);
    assert.equal(seen.size,344);
    const noResults=await listSalesProspectsPage(pool,{
      search:'CRM-PAGE-CI-NEVER-MATCH',page:1
    });
    assert.equal(noResults.total,0);
    assert.deepEqual(noResults.items,[]);
    assert.equal(noResults.more,false);
    const narrowed=await listSalesProspectsPage(pool,{
      search:prefix+'0344',page:1
    });
    assert.equal(narrowed.total,1);
    assert.equal(narrowed.items[0].company_name,prefix+'0344');
  }finally{await pool.end();}
});
