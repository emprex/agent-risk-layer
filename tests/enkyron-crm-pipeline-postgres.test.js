import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity,updateOpportunity}
  from '../desktop/enkyron-crm-opportunities.mjs';
import {getSalesPipeline} from '../desktop/enkyron-crm-pipeline.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only disposable CI may be written');
  const uri=new URL(url);
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(uri.pathname,'/arl_ci');
  assert.equal(uri.username,'arl_ci');
  assert.equal(uri.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL: stage map, 31-item lane count, 30-card bound and existing audited edits', {
  skip:!url&&'Disposable CI PostgreSQL only',
  timeout:50_000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-pipeline-'+randomUUID().slice(0,8);
  try{
    const user='usr_pipeline_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-pipeline-'+randomUUID()+'@example.invalid','synthetic']);
    const stages=new Array(31).fill('research').concat(
      ['contacted','negotiation','won','lost']);
    for(let i=0;i<stages.length;i++){
      const id='lead_pipeline_'+randomUUID();
      const company='Synthetic Pipeline '+i;
      await pool.query(
        'INSERT INTO sales_prospects (id,company_name,source,created_by,created_at,updated_at) '
        +'VALUES($1,$2,$3,$4,NOW(),NOW())',
        [id,company,'synthetic-ci',user]
      );
      const opportunity=await createOpportunity(pool,{
        prospect_id:id,company_name_at_review:company,
        next_action:'Manual stage review for test opportunity '+i,
        due_date:null
      },actor);
      if(stages[i]!=='research'){
        const changed=await updateOpportunity(pool,{
          id:opportunity.id,expected_version:1,stage:stages[i],
          next_action:'Operator recorded manual stage transition '+i,
          due_date:null
        },actor);
        assert.equal(changed.version,2);
      }
    }
    const before=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunity_events '
      +'WHERE workspace_key=$1',['local:'+actor]
    )).rows[0].n;
    const pipeline=await getSalesPipeline(pool,actor);
    assert.equal(pipeline.available,true);
    assert.equal(pipeline.total,35);
    assert.deepEqual(pipeline.lanes.map(l=>l.total),[31,1,1,1,1]);
    assert.deepEqual(pipeline.lanes.map(l=>l.items.length),[30,1,1,1,1]);
    assert.equal(pipeline.lanes[0].more,true);
    assert.ok(pipeline.lanes.slice(1).every(l=>!l.more));
    assert.deepEqual(pipeline.lanes.map(l=>l.id),
      ['prospecting','engagement','proposal','won','lost']);
    const ids=pipeline.lanes.flatMap(l=>l.items.map(v=>v.id));
    assert.equal(ids.length,new Set(ids).size);
    assert.equal(pipeline.lanes[2].items[0].stage,'negotiation');
    assert.equal(pipeline.lanes[3].items[0].stage,'won');
    assert.equal(pipeline.lanes[4].items[0].stage,'lost');
    const unseen=await getSalesPipeline(pool,'ci-different-user');
    assert.equal(unseen.total,0);
    assert.ok(unseen.lanes.every(x=>x.total===0&&x.items.length===0));
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunity_events '
      +'WHERE workspace_key=$1',['local:'+actor]
    )).rows[0].n,before,'Pipeline reads must never create or modify events');
  }finally{await pool.end();}
});
