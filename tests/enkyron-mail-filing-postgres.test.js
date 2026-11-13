import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {moveMailThread} from '../desktop/enkyron-mail-filing.mjs';

const raw=process.env.ARL_CI_POSTGRES_URL||'';
function ciUrl(){
  assert.equal(process.env.CI,'true','Disposable CI database only');
  const u=new URL(raw);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return raw;
}
test('local filing audit survives provider mock and denies unprovisioned owners',{
  skip:!raw&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciUrl(),max:2});
  const owner='ci-mail-file-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner;
  const thread=crypto.randomUUID();
  const inbox=crypto.randomUUID();
  const values={mailbox:'direction',thread_id:thread,from_folder:'inbox',
    to_folder:'archive',confirmed:true};
  const calls=[];
  const options={
    credentialsLoader:async()=>({
      mailboxes:{direction:inbox},
      credentialProvider:async()=> 'synthetic-key'
    }),
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return init.method==='GET'
        ?{ok:true,json:async()=>({id:thread,folder:'inbox'})}
        :{ok:true};
    }
  };
  try{
    await assert.rejects(
      ()=>moveMailThread(pool,owner,values,options),/permission/);
    assert.equal(calls.length,0);
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,can_manage,granted_by) '+
      "VALUES($1,'direction','organization_owner_l5',TRUE,TRUE,TRUE,$2)",
      [scope,owner]
    );
    const result=await moveMailThread(pool,owner,values,options);
    assert.equal(result.moved,true);
    assert.deepEqual(calls.map(x=>x.init.method),['GET','PATCH']);
    assert.equal(JSON.parse(calls[1].init.body).folder,'archive');
    const events=(await pool.query(
      'SELECT event_kind,operation_id FROM enkyron_mail_filing_events '+
      'WHERE workspace_key=$1 ORDER BY occurred_at,id',
      [scope]
    )).rows;
    assert.equal(events.length,2);
    assert.deepEqual(new Set(events.map(x=>x.event_kind)),
      new Set(['requested','provider_confirmed']));
    assert.equal(events[0].operation_id,events[1].operation_id);
    await assert.rejects(
      pool.query('DELETE FROM enkyron_mail_filing_events WHERE workspace_key=$1',
      [scope]),/immutable|read-only|denied|forbidden|cannot/i);
  }finally{await pool.end();}
});
