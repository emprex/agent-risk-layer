import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  localMailFolders,createLocalMailFolder,localMailList,syncMailHeaders,
  localMailMessages,fetchAndCacheThread,moveLocalThread,localMailLabels,
  createLocalLabel,labelLocalThread
} from '../desktop/enkyron-mail-local.mjs';
import {calendarCreate,calendarCreateTask,calendarCompleteTask,calendarList,
  validateCalendarEvent} from '../desktop/enkyron-calendar.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function ciConnection(){
  assert.equal(process.env.CI,'true','Synthetic disposable CI only');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('Local folders/labels/cache stay in PostgreSQL, never mutate Resend and calendar is local',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:3});
  const owner='ci-enkyron-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner;
  const thread=crypto.randomUUID(),message=crypto.randomUUID();
  const sentActions=[];
  try{
    const schema=(await pool.query(
      "SELECT to_regclass('enkyron_mail_local_threads') AS mail,"+
      "to_regclass('enkyron_calendar_events') AS calendar"
    )).rows[0];
    assert.ok(schema.mail);assert.ok(schema.calendar);
    const folder=await createLocalMailFolder(pool,owner,{name:'Prospects FIFA'});
    assert.match(folder.key,/^user_[a-f0-9]{32}$/);
    assert.ok((await localMailFolders(pool,owner)).folders.some(x=>x.name==='Prospects FIFA'));
    const result=await syncMailHeaders(pool,owner,{mailbox:'direction'},{
      listThreads:async(_pool,_owner,mailbox,providerFolder)=>{
        sentActions.push(['GET',mailbox,providerFolder]);
        return {items:providerFolder==='inbox'?
          [{id:thread,subject:'Synthetic assessment request',
            last_message_at:'2026-11-11T11:00:00Z',unread:true}]:[],
          has_more:false};
      }
    });
    assert.equal(result.imported,1);
    assert.equal(result.partial,false);
    assert.equal(sentActions.length,4);
    assert.ok(sentActions.every(x=>x[0]==='GET'));
    const before=await localMailList(pool,owner,{folder:'inbox',mailbox:'direction'});
    assert.equal(before.items.length,1);
    const changed=await moveLocalThread(pool,owner,{
      mailbox:'direction',thread_id:thread,folder:folder.key
    });
    assert.equal(changed.provider_unchanged,true);
    const after=await localMailList(pool,owner,{folder:folder.key,mailbox:'direction'});
    assert.equal(after.items.length,1);
    assert.equal((await localMailList(pool,owner,{folder:'inbox'})).items.length,0);
    // Another provider sync must NOT reset ENKYRON's chosen local folder.
    await syncMailHeaders(pool,owner,{mailbox:'direction'},{
      listThreads:async()=>({items:[
        {id:thread,subject:'Synthetic assessment request',last_message_at:'2026-11-11T12:00:00Z'}
      ],has_more:false})
    });
    assert.equal((await localMailList(pool,owner,{folder:folder.key})).items.length,1);
    const cached=await fetchAndCacheThread(pool,owner,{
      mailbox:'direction',thread_id:thread
    },{listMessages:async()=>({items:[{
      id:message,from:'safe@example.invalid',to:['operator@example.invalid'],
      subject:'Synthetic assessment request',created_at:'2026-11-11T11:00:00Z',
      text:'Text only <script>literal, never executed</script>',
      html_only:false
    }]})});
    assert.equal(cached.items.length,1);
    assert.match(cached.items[0].text,/<script>literal/);
    const reread=await localMailMessages(pool,owner,{mailbox:'direction',thread_id:thread});
    assert.equal(reread.items.length,1);
    const label=await createLocalLabel(pool,owner,{name:'Needs Assessment'});
    assert.ok((await localMailLabels(pool,owner)).labels.some(x=>x.id===label.id));
    await labelLocalThread(pool,owner,{mailbox:'direction',thread_id:thread,label_id:label.id,applied:true});
    assert.match((await localMailList(pool,owner,{folder:folder.key})).items[0].labels,/Needs Assessment/);
    await labelLocalThread(pool,owner,{mailbox:'direction',thread_id:thread,label_id:label.id,applied:false});
    assert.equal((await localMailList(pool,owner,{folder:folder.key})).items[0].labels,'');
    const appointment=await calendarCreate(pool,owner,{
      title:'Zeus AI qualification call',
      starts_at:'2026-11-12T10:00:00+00:00',
      ends_at:'2026-11-12T11:00:00+00:00',
      timezone:'Europe/London',notes:'Private synthetic appointment'
    });
    const task=await calendarCreateTask(pool,owner,{
      title:'Follow up FIFA prospect',due_at:'2026-11-13T17:00:00Z'
    });
    const list=await calendarList(pool,owner,{
      start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'
    });
    assert.ok(list.events.some(x=>x.id===appointment.id));
    assert.ok(list.tasks.some(x=>x.id===task.id));
    assert.equal((await calendarCompleteTask(pool,owner,{id:task.id,completed:true})).completed,true);
    const history=(await pool.query(
      'SELECT event_kind FROM enkyron_mail_local_events WHERE workspace_key=$1',
      [scope]
    )).rows.map(x=>x.event_kind);
    for(const kind of ['folder_created','thread_moved','label_created',
      'thread_labeled','thread_unlabeled','calendar_created',
      'task_created','task_completed'])assert.ok(history.includes(kind),kind);
    await assert.rejects(pool.query(
      'DELETE FROM enkyron_mail_local_events WHERE workspace_key=$1',[scope]
    ),/immutable|read-only|denied|forbidden|cannot/i);
  }finally{await pool.end();}
});

test('Calendar input is validated and cannot produce implicit invitations',()=>{
  assert.throws(()=>validateCalendarEvent({title:'Meeting',
    starts_at:'2026-11-12T10:00:00+00:00',ends_at:'2026-11-12T09:00:00+00:00'
  }),/interval/);
  assert.throws(()=>validateCalendarEvent({title:'Meeting',
    starts_at:'2026-11-12T10:00:00+00:00',
    ends_at:'2026-11-12T11:00:00+00:00',timezone:'fake/unknown'
  }),/timezone/);
});
