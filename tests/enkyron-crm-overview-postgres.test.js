import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity,updateOpportunity}
  from '../desktop/enkyron-crm-opportunities.mjs';
import {createMailDraft} from '../desktop/enkyron-crm-mail-drafts.mjs';
import {getSalesOverview} from '../desktop/enkyron-crm-overview.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true','Use disposable CI only');
  const uri=new URL(url);
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(uri.pathname,'/arl_ci');
  assert.equal(uri.username,'arl_ci');
  assert.equal(uri.password,'synthetic-ci-only');
  return url;
}
function addDays(iso,n){
  const d=new Date(iso+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
test('real commercial dashboard counts current opportunities and excludes closed due dates', {
  skip:!url&&'Only disposable CI PostgreSQL',
  timeout:45_000
},async()=>{
  const db=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-overview-'+randomUUID().slice(0,8);
  try{
    const today=(await db.query(
      "SELECT (now() AT TIME ZONE 'Europe/London')::date::text AS day"
    )).rows[0].day;
    const userId='usr_dashboard_'+randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [userId,'ci-'+randomUUID()+'@example.invalid','ci-only']
    );
    const dates=[addDays(today,-2),today,addDays(today,3),addDays(today,-1)];
    const opportunities=[];
    for(let i=0;i<4;i++){
      const lead='lead_overview_'+randomUUID(),name='Synthetic Overview '+i;
      await db.query(
        'INSERT INTO sales_prospects '
        +'(id,company_name,source,created_by,created_at,updated_at) '
        +'VALUES($1,$2,$3,$4,NOW(),NOW())',
        [lead,name,'synthetic-ci',userId]
      );
      opportunities.push(await createOpportunity(db,{
        prospect_id:lead,company_name_at_review:name,
        next_action:'Manually review synthetic proposal '+i,due_date:dates[i]
      },actor));
    }
    await updateOpportunity(db,{
      id:opportunities[3].id,expected_version:1,stage:'won',
      next_action:'Operator marked synthetic opportunity as won',
      due_date:dates[3]
    },actor);
    await createMailDraft(db,{
      opportunity_id:opportunities[0].id,recipient_email:'',
      subject:'A saved internal test proposal',body_text:'Not sent anywhere.'
    },actor);
    const summary=await getSalesOverview(db,actor);
    assert.equal(summary.available,true);
    const data=summary.overview;
    assert.equal(data.as_of,today);
    assert.equal(data.opportunities,4);
    assert.equal(data.active_opportunities,3);
    assert.equal(data.overdue,1);
    assert.equal(data.due_today,1);
    assert.equal(data.due_next_week,1);
    assert.equal(data.saved_drafts,1);
    assert.equal(data.registered_companies,0);
    assert.equal(data.priority_items.length,3);
    assert.ok(data.priority_items.every(x=>x.stage!=='won'));
    assert.equal(data.priority_items[0].due_date.slice(0,10),dates[0]);
    const other=await getSalesOverview(db,'ci-no-overview');
    assert.equal(other.overview.opportunities,0);
    assert.equal(other.overview.saved_drafts,0);
    assert.equal(other.overview.overdue,0);
    const direct=(await db.query('SELECT count(*)::int AS n FROM sales_prospects'))
      .rows[0].n;
    assert.equal(data.researched_prospects,direct);
  }finally{await db.end();}
});
