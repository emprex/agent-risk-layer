import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {
  createCompanyFollowup,updateCompanyFollowup,
  listCompanyFollowups,listUpcomingCompanyFollowups
} from '../desktop/enkyron-crm-company-followups.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only synthetic CI database can be written');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('UX-13 company-owned dates, multiple tasks, lifecycle, revision conflicts and immutable history',{
  skip:!url&&'Dedicated disposable PostgreSQL required',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-cotask-'+randomUUID().slice(0,8);
  const stranger='ci-stranger-'+randomUUID().slice(0,8);
  try{
    const company=await createCompany(pool,{name:'Synthetic followup '+randomUUID().slice(0,8)},actor);
    const other=await createCompany(pool,{name:'Other company '+randomUUID().slice(0,8)},actor);
    const action_text='Review whether the synthetic introduction received a response';
    const input={company_id:company.id,action_text,due_date:'2026-11-17',confirmed:true};
    const first=await createCompanyFollowup(pool,input,actor);
    const second=await createCompanyFollowup(pool,{
      ...input,due_date:'2026-11-12',action_text:'Review early inbound message inbox'
    },actor);
    assert.notEqual(first.id,second.id);
    assert.equal(first.version,1);
    const noOpportunity=(await pool.query(
      'SELECT count(*)::int AS count FROM enkyron_crm_opportunities WHERE workspace_key=$1',
      ['local:'+actor]
    )).rows[0].count;
    assert.equal(noOpportunity,0);
    const a=await listCompanyFollowups(pool,company.id,actor);
    assert.deepEqual(a.items.slice(0,2).map(t=>t.id),[second.id,first.id]);
    assert.ok(a.items.every(t=>t.company_id===company.id));
    assert.equal((await listCompanyFollowups(pool,other.id,actor)).items.length,0);
    assert.equal((await listUpcomingCompanyFollowups(pool,actor)).items.length,2);
    assert.equal((await listUpcomingCompanyFollowups(pool,stranger)).items.length,0);
    await assert.rejects(
      ()=>listCompanyFollowups(pool,company.id,stranger),/company not found/
    );
    await assert.rejects(
      ()=>createCompanyFollowup(pool,input,stranger),/company not found/
    );
    const adjusted=await updateCompanyFollowup(pool,{
      id:first.id,expected_version:1,status:'open',action_text,
      due_date:'2026-11-24',confirmed:true
    },actor);
    assert.equal(adjusted.version,2);
    await assert.rejects(
      ()=>updateCompanyFollowup(pool,{
        id:first.id,expected_version:1,status:'open',action_text,
        due_date:'2026-11-25',confirmed:true
      },actor),/changed; reload/);
    const completed=await updateCompanyFollowup(pool,{
      id:first.id,expected_version:2,status:'completed',action_text,
      due_date:'2026-11-24',confirmed:true
    },actor);
    assert.equal(completed.version,3);
    await assert.rejects(
      ()=>updateCompanyFollowup(pool,{
        id:first.id,expected_version:3,status:'open',action_text,
        due_date:'2026-11-26',confirmed:true
      },actor),/closed.*cannot be edited/);
    await updateCompanyFollowup(pool,{
      id:second.id,expected_version:1,status:'cancelled',
      action_text:'Review early inbound message inbox',due_date:'2026-11-12',
      confirmed:true
    },actor);
    assert.equal((await listUpcomingCompanyFollowups(pool,actor)).items.length,0);
    const eventRows=(await pool.query(
      'SELECT version,event_type,old_status,new_status FROM enkyron_crm_company_followup_events '
      +'WHERE workspace_key=$1 AND followup_id=$2 ORDER BY version',
      ['local:'+actor,first.id]
    )).rows;
    assert.deepEqual(eventRows.map(t=>t.version),[1,2,3]);
    assert.deepEqual(eventRows.map(t=>t.new_status),['open','open','completed']);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_company_followup_events WHERE followup_id=$1',
      [first.id]
    ),/cannot be changed or deleted/);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM enkyron_crm_opportunities WHERE workspace_key=$1',
      ['local:'+actor]
    )).rows[0].count,0);
  }finally{await pool.end();}
});
