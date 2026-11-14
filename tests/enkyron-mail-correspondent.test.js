import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {localMailList} from '../desktop/enkyron-mail-local.mjs';
import {OWNER_MAILBOXES} from '../desktop/enkyron-owner-mail-access.mjs';

const own=OWNER_MAILBOXES.map(({address})=>address.toLowerCase());

test('local conversation list selects external participants, not the most recent sender',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[{mailbox:'direction',id:randomUUID(),subject:'Synthetic thread',
      sender:'Samuel Essiaw <sam@example.invalid>'}]};
  }};
  const result=await localMailList(pool,'mail-test',{folder:'inbox'});
  assert.equal(result.items[0].sender,'Samuel Essiaw <sam@example.invalid>');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].params,
    ['local:mail-test','inbox','all','',0,own]);
  assert.match(calls[0].sql,/COALESCE\(external_mail\.sender,external_to\.recipient/);
  assert.match(calls[0].sql,/jsonb_array_elements_text/);
  assert.match(calls[0].sql,/< > ALL|<> ALL/);
  assert.doesNotMatch(calls[0].sql,/last_mail\.sender/);
  assert.match(calls[0].sql,/^SELECT\s/i);
});

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only isolated GitHub Actions PostgreSQL');
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  assert.equal(u.search,'');
  return url;
}

test('PostgreSQL: replies keep the external name; outbound-only uses the recipient',{
  skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:2});
  const actor='ci-correspondent-'+randomUUID().slice(0,8);
  const workspace='local:'+actor;
  async function thread(subject,mailbox='direction'){
    const id=randomUUID();
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject,last_message_at,unread) '+
      "VALUES($1,$2,$3,'inbox','inbox',$4,$5,false)",
      [workspace,mailbox,id,subject,'2026-11-14T22:00:00Z']);
    return id;
  }
  async function message(threadId,mailbox,sender,to,when,subject){
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,sender,recipients,'+
      'subject,body_text,html_only,created_at) '+
      'VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,false,$9)',
      [workspace,mailbox,threadId,randomUUID(),sender,JSON.stringify(to),
        subject,'Synthetic CI mail without private information',when]);
  }
  try{
    const sam='Samuel external reply',jay='Jayanthi external reply',
      sent='Outbound-only contact',internal='Internal-only thread',
      uncached='Uncached thread';
    const a=await thread(sam),b=await thread(jay),
      c=await thread(sent),d=await thread(internal),
      e=await thread(uncached);
    await message(a,'direction','Samuel Essiaw <sam@example.invalid>',
      [own[0]],'2026-11-13T09:12:00Z',sam);
    await message(a,'direction','Guillaume Strohecker <'+own[0]+'>',
      ['sam@example.invalid'],'2026-11-13T09:54:00Z',sam);
    await message(b,'direction','Jayanthi <jayanthi@example.invalid>',
      [own[0]],'2026-11-13T08:00:00Z',jay);
    await message(b,'direction','Guillaume Strohecker <'+own[0]+'>',
      ['jayanthi@example.invalid'],'2026-11-14T21:50:00Z',jay);
    await message(c,'direction',own[0],['Client <buyer@example.invalid>'],
      '2026-11-14T21:00:00Z',sent);
    await message(d,'direction',own[0],[own[1]],
      '2026-11-14T20:00:00Z',internal);
    const listed=await localMailList(pool,actor,{folder:'inbox'});
    const found=new Map(listed.items.map(({subject,sender})=>[subject,sender]));
    assert.equal(found.get(sam),'Samuel Essiaw <sam@example.invalid>');
    assert.equal(found.get(jay),'Jayanthi <jayanthi@example.invalid>');
    assert.equal(found.get(sent),'Client <buyer@example.invalid>');
    assert.equal(found.get(internal),'');
    assert.equal(found.get(uncached),'');
  }finally{
    await pool.end();
  }
});
