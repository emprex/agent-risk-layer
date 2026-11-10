import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {recordPersonalProfile,readPersonalProfile}
  from '../desktop/enkyron-operator-personal-profile.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function ciUrl(){
  assert.equal(process.env.CI,'true','Only CI database is writable');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('UX-15A append-only operator display profiles isolate local workspaces and preserve history',{
  skip:!url&&'Disposable PostgreSQL only',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:ciUrl(),max:2});
  const actor='ci-owner-'+randomUUID().slice(0,8);
  const other='ci-other-'+randomUUID().slice(0,8);
  const first={expected_revision:0,display_name:'Synthetic Founder',
    job_title:'Founder',organization_display:'Synthetic Org',
    work_email:'founder@example.invalid',confirmed:true};
  try{
    const rev1=await recordPersonalProfile(pool,first,actor);
    assert.equal(rev1.revision,1);
    const original=await readPersonalProfile(pool,actor);
    assert.equal(original.current.display_name,'Synthetic Founder');
    assert.equal(original.current.declared_role,'founder_owner_unverified');
    assert.equal(original.local_operator,actor);
    assert.equal((await readPersonalProfile(pool,other)).current,null);
    await assert.rejects(()=>recordPersonalProfile(pool,first,actor),/changed|unchanged/);
    await assert.rejects(()=>recordPersonalProfile(pool,{
      ...first,expected_revision:1,display_name:'Synthetic Founder',
    },actor),/unchanged/);
    const second=await recordPersonalProfile(pool,{
      ...first,expected_revision:1,job_title:'Founder and Researcher'
    },actor);
    assert.equal(second.revision,2);
    const history=await readPersonalProfile(pool,actor);
    assert.equal(history.current.job_title,'Founder and Researcher');
    assert.equal(history.history.length,2);
    assert.deepEqual(history.history.map(x=>x.revision),[2,1]);
    const rows=(await pool.query(
      'SELECT revision,recorded_by FROM enkyron_operator_personal_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision',['local:'+actor]
    )).rows;
    assert.deepEqual(rows.map(x=>Number(x.revision)),[1,2]);
    assert.ok(rows.every(x=>x.recorded_by===actor));
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_operator_personal_profiles SET job_title=$1 '
      +'WHERE workspace_key=$2',['Altered','local:'+actor]
    ),/cannot be changed or deleted|immutable|not allowed/i);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_operator_personal_profiles WHERE workspace_key=$1',
      ['local:'+actor]
    ),/cannot be changed or deleted|immutable|not allowed/i);
    const otherRows=(await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_operator_personal_profiles '
      +'WHERE workspace_key=$1',['local:'+other]
    )).rows[0].n;
    assert.equal(otherRows,0);
  }finally{await pool.end();}
});
