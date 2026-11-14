// Regression: local Mail read state must pass the desktop command gates.
// Only synthetic isolated CI PostgreSQL is used for persistent-state tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setLocalThreadRead} from '../desktop/enkyron-mail-local.mjs';

const bridge=readFileSync(new URL('../desktop/enkyron-bridge.mjs',import.meta.url),'utf8');
const segments=bridge.split('\n');
function commandLine(prefix){
  const matches=segments.filter(line=>line.trimStart().startsWith(prefix));
  assert.equal(matches.length,1,'Exactly one desktop command gate: '+prefix);
  return matches[0];
}

test('read-status command is accepted, parsed and granted a writable DB transaction',()=>{
  const command="'mail-local-read'";
  assert.ok(commandLine('if (![\'tickets\'').includes(command),
    'command must not be refused by desktop allowlist');
  assert.ok(commandLine('const payload =').includes(command),
    'read-status request must reach backend with exact payload');
  assert.ok(commandLine('const readOnly =').includes(command),
    'read-status UPDATE must not use read-only transaction');
  assert.match(bridge,/command === 'mail-local-read' \? await setLocalThreadRead\(/);
  assert.match(bridge,/command === 'mail-local-read'/);
});

test('local read update is scoped and idempotent, with no transport side effects',async()=>{
  const thread='11111111-2222-4333-8444-555555555555';
  const queries=[];
  let stored=true;
  const client={
    async query(sql,params=[]){
      queries.push({sql,params});
      if(sql.startsWith('UPDATE enkyron_mail_local_threads')){
        assert.deepEqual(params,['local:tester','direction',thread,false]);
        assert.match(sql,/workspace_key=\$1 AND mailbox_key=\$2 AND thread_id=\$3/);
        assert.match(sql,/unread IS DISTINCT FROM \$4/);
        if(stored===false)return {rowCount:0,rows:[]};
        stored=false;return {rowCount:1,rows:[{unread:false}]};
      }
      if(sql.startsWith('SELECT unread FROM enkyron_mail_local_threads')){
        assert.deepEqual(params,['local:tester','direction',thread]);
        return {rows:[{unread:stored}]};
      }
      return {rows:[]};
    },
    release(){}
  };
  const pool={connect:async()=>client};
  let a=await setLocalThreadRead(pool,'tester',
    {mailbox:'direction',thread_id:thread,unread:false});
  assert.equal(a.unread,false);
  assert.equal(a.changed,true);
  let b=await setLocalThreadRead(pool,'tester',
    {mailbox:'direction',thread_id:thread,unread:false});
  assert.deepEqual(b,{unread:false,changed:false});
  assert.equal(stored,false);
  assert.ok(queries.every(({sql})=>!/(?:resend|provider|mail_send|DELETE)/i.test(sql)));
});

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Isolated GitHub Actions CI only');
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}

test('PostgreSQL read/unread toggles only exact selected synthetic thread',{
  skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const actor='ci-read-'+randomUUID().slice(0,8);
  const key='local:'+actor, id=randomUUID(),other=randomUUID();
  try{
    for(const t of [id,other]){
      await pool.query(
        'INSERT INTO enkyron_mail_local_threads '+
        '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject,unread) '+
        "VALUES($1,'direction',$2,'inbox','inbox','Synthetic read state',true)",
        [key,t]);
    }
    const first=await setLocalThreadRead(pool,actor,{
      mailbox:'direction',thread_id:id,unread:false});
    assert.equal(first.unread,false);
    assert.equal(first.changed,true);
    const second=await setLocalThreadRead(pool,actor,{
      mailbox:'direction',thread_id:id,unread:false});
    assert.equal(second.unread,false);
    assert.equal(second.changed,false);
    const rows=(await pool.query(
      'SELECT thread_id,unread FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 ORDER BY thread_id',
      [key,'direction'])).rows;
    const state=new Map(rows.map(r=>[String(r.thread_id),r.unread]));
    assert.equal(state.get(id),false);
    assert.equal(state.get(other),true);
    await assert.rejects(
      setLocalThreadRead(pool,'unrelated-ci-actor',{
        mailbox:'direction',thread_id:id,unread:false}),/Mail thread not found/);
  }finally{
    await pool.end();
  }
});
