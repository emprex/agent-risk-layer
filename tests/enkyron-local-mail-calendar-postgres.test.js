import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {archiveNextMailBatch,mailArchiveStatus,quarantineAttachmentBytes,readArchivedFullText} from '../desktop/enkyron-mail-archive.mjs';
import {
  localMailFolders,createLocalMailFolder,renameLocalMailFolder,deleteEmptyLocalMailFolder,localMailList,syncMailHeaders,
  localMailMessages,fetchAndCacheThread,syncLocalMailBodies,moveLocalThread,localMailLabels,
  createLocalLabel,labelLocalThread,flagLocalThread,setLocalThreadRead,localMailCompanyLink,linkLocalMailCompany
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

test('bounded body import persists received text once, without transport mutation',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-local-body-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID(),message=crypto.randomUUID();
  const calls=[];
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'trash','inbox','Saved internal mail')",
      [scope,thread]
    );
    const options={listMessages:async(_pool,_actor,mailbox,requested)=>{
      calls.push({mailbox,requested,verb:'GET'});
      return {items:[{id:message,from:'client@example.invalid',
        to:['guillaume@example.invalid'],subject:'Saved internal mail',
        text:'Retained in ENKYRON even if provider later removes thread',
        created_at:'2026-11-11T10:00:00Z',html_only:false}]};
    }};
    const first=await syncLocalMailBodies(pool,owner,{mailbox:'direction'},options);
    assert.equal(first.cached_threads,1);
    assert.equal(first.failed_threads,0);
    assert.deepEqual(calls.map(x=>x.verb),['GET']);
    const snapshot=await localMailMessages(pool,owner,{
      mailbox:'direction',thread_id:thread
    });
    assert.equal(snapshot.items.length,1);
    assert.match(snapshot.items[0].text,/Retained in ENKYRON/);
    const second=await syncLocalMailBodies(pool,owner,{mailbox:'direction'},options);
    assert.equal(second.cached_threads,0);
    assert.equal(calls.length,1);
    assert.equal((await localMailList(pool,owner,{folder:'inbox'})).items.length,1);
    assert.equal((await pool.query(
      'SELECT provider_folder FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND thread_id=$2',[scope,thread]
    )).rows[0].provider_folder,'trash');
  }finally{await pool.end();}
});


test('header paging stores all 65 provider conversations without duplicates after restart',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-paged-head-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner;
  const ids=Array.from({length:65},()=>crypto.randomUUID());
  const calls=[];
  const listThreads=async(_pool,_actor,mailbox,folder,after=null)=>{
    calls.push({mailbox,folder,after});
    if(folder!=='inbox')return {items:[],has_more:false};
    const start=after===null?0:ids.indexOf(after)+1;
    assert.ok(start>=0);
    const page=ids.slice(start,start+30);
    return {items:page.map((id,i)=>({
      id,subject:'Synthetic '+String(start+i),
      last_message_at:'2026-11-11T11:00:00Z',unread:false
    })),has_more:start+page.length<ids.length};
  };
  try{
    const first=await syncMailHeaders(pool,owner,{mailbox:'direction'},{listThreads});
    assert.equal(first.imported,30);
    assert.equal(first.more_pending,true);
    assert.deepEqual(Object.keys(first.continuation),['direction/inbox']);
    // Simulate a terminated UI: starting from page one only replays the same IDs.
    await syncMailHeaders(pool,owner,{mailbox:'direction'},{listThreads});
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_local_threads WHERE workspace_key=$1',
      [scope])).rows[0].n,30);
    const second=await syncMailHeaders(pool,owner,{
      mailbox:'direction',cursors:first.continuation
    },{listThreads});
    assert.equal(second.imported,30);
    assert.equal(second.more_pending,true);
    const third=await syncMailHeaders(pool,owner,{
      mailbox:'direction',cursors:second.continuation
    },{listThreads});
    assert.equal(third.imported,5);
    assert.equal(third.more_pending,false);
    const record=(await pool.query(
      'SELECT count(*)::int AS n,count(DISTINCT thread_id)::int AS unique_n '+
      'FROM enkyron_mail_local_threads WHERE workspace_key=$1',[scope]
    )).rows[0];
    assert.equal(record.n,65);
    assert.equal(record.unique_n,65);
    assert.ok(calls.every(x=>x.mailbox==='direction'));
    await assert.rejects(syncMailHeaders(pool,owner,{
      mailbox:'direction',cursors:{'support/inbox':ids[0]}
    },{listThreads}),/Invalid Mail pagination state/);
  }finally{await pool.end();}
});

test('body pages resume after interruption and preserve exactly 65 unique messages',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-paged-body-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID();
  const ids=Array.from({length:65},()=>crypto.randomUUID());
  const calls=[];
  const listMessages=async(_pool,_actor,mailbox,threadId,after=null)=>{
    assert.equal(mailbox,'direction');
    assert.equal(threadId,thread);
    calls.push(after);
    const start=after===null?0:ids.indexOf(after)+1;
    assert.ok(start>=0);
    const page=ids.slice(start,start+30);
    return {items:page.map((id,i)=>({
      id,from:'client@example.invalid',to:['owner@example.invalid'],
      subject:'Synthetic reply '+String(start+i),
      text:'Safe synthetic content '+String(start+i),
      created_at:'2026-11-11T10:00:00Z',html_only:false
    })),has_more:start+page.length<ids.length};
  };
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox','inbox','Paginated test')",
      [scope,thread]
    );
    const first=await syncLocalMailBodies(pool,owner,{
      mailbox:'direction',rescan:true
    },{listMessages});
    assert.equal(first.failed_threads,0);
    assert.equal(first.more_pending,true);
    assert.equal(calls.length,2);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_local_messages '+
      'WHERE workspace_key=$1',[scope])).rows[0].n,60);
    // Crash/restart without the in-memory continuation: repeat first two pages.
    await syncLocalMailBodies(pool,owner,{
      mailbox:'direction',rescan:true
    },{listMessages});
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_local_messages '+
      'WHERE workspace_key=$1',[scope])).rows[0].n,60);
    const finished=await syncLocalMailBodies(pool,owner,{
      mailbox:'direction',rescan:true,...first.continuation
    },{listMessages});
    assert.equal(finished.failed_threads,0);
    assert.equal(finished.more_pending,false);
    const totals=(await pool.query(
      'SELECT count(*)::int AS n,count(DISTINCT message_id)::int AS unique_n '+
      'FROM enkyron_mail_local_messages WHERE workspace_key=$1',[scope]
    )).rows[0];
    assert.equal(totals.n,65);
    assert.equal(totals.unique_n,65);
    assert.equal((await localMailMessages(pool,owner,{
      mailbox:'direction',thread_id:thread
    })).has_more,true); // preview is bounded; persistence is not.
    assert.deepEqual(calls.slice(0,2),[null,ids[29]]);
    assert.equal(calls.at(-1),ids[59]);
  }finally{await pool.end();}
});


test('saved-mail search finds cached bodies, recipients and labels across folders, with paging and audit',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-search-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,match=crypto.randomUUID();
  try{
    const ids=[match,...Array.from({length:52},()=>crypto.randomUUID())];
    for(let i=0;i<ids.length;i++){
      await pool.query(
        'INSERT INTO enkyron_mail_local_threads '+
        '(workspace_key,mailbox_key,thread_id,folder_key,subject,last_message_at) '+
        'VALUES($1,$2,$3,$4,$5,$6)',
        [scope,'direction',ids[i],i===0?'archive':'inbox',
          'Case '+i,'2026-11-11T10:00:00Z']
      );
    }
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,sender,recipients,'+
      'subject,body_text,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',
      [scope,'direction',match,crypto.randomUUID(),
        'operator@example.invalid',JSON.stringify(['destination@example.invalid']),
        'Normal subject','The sapphireCipher request body',
        '2026-11-11T10:00:00Z']
    );
    const first=await localMailList(pool,owner,{folder:'inbox',page:0});
    assert.equal(first.items.length,50);
    assert.equal(first.has_more,true);
    const second=await localMailList(pool,owner,{folder:'inbox',page:1});
    assert.equal(second.items.length,2);
    assert.equal(second.has_more,false);
    assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,52);
    for(const search of ['sapphireCipher','destination@','operator@example.invalid']){
      const hits=await localMailList(pool,owner,{
        mailbox:'direction',folder:'all',search
      });
      assert.equal(hits.items.length,1);
      assert.equal(hits.items[0].id,match);
      assert.equal(hits.items[0].folder_key,'archive');
    }
    // LIKE wildcard is literal, not a way to return every secret record.
    assert.equal((await localMailList(pool,owner,{folder:'all',search:'%'})).items.length,0);
    const label=await createLocalLabel(pool,owner,{name:'Purple Follow Up'});
    await labelLocalThread(pool,owner,{
      mailbox:'direction',thread_id:match,label_id:label.id,applied:true
    });
    assert.equal((await localMailList(pool,owner,{
      folder:'all',search:'Purple Follow Up'
    })).items[0].id,match);
    const firstFlag=await flagLocalThread(pool,owner,{
      mailbox:'direction',thread_id:match,flagged:true
    });
    assert.deepEqual(firstFlag,{flagged:true,changed:true});
    const repeated=await flagLocalThread(pool,owner,{
      mailbox:'direction',thread_id:match,flagged:true
    });
    assert.deepEqual(repeated,{flagged:true,changed:false});
    const flagged=(await localMailList(pool,owner,{
      folder:'all',search:'sapphireCipher'
    })).items[0];
    assert.equal(flagged.flagged,true);
    await flagLocalThread(pool,owner,{
      mailbox:'direction',thread_id:match,flagged:false
    });
    const history=(await pool.query(
      'SELECT event_kind FROM enkyron_mail_local_events '+
      'WHERE workspace_key=$1 AND event_kind LIKE $2 ORDER BY occurred_at',
      [scope,'thread_%flagged']
    )).rows;
    assert.deepEqual(history.map(x=>x.event_kind),
      ['thread_flagged','thread_unflagged']);
    await assert.rejects(localMailList(pool,owner,{
      folder:'all',search:''
    }),/search term is required/i);
    await assert.rejects(localMailList(pool,owner,{
      folder:'inbox',page:-1
    }),/Invalid Mail page/);
    await assert.rejects(flagLocalThread(pool,owner,{
      mailbox:'direction',thread_id:crypto.randomUUID(),flagged:true
    }),/not found/);
  }finally{await pool.end();}
});


test('large inbound body uses explicit 112 marker and complete 113 archive only after provider GET',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-body-limit-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID(),id=crypto.randomUUID();
  const content='X'.repeat(25000);
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,subject) VALUES($1,$2,$3,$4)',
      [scope,'direction',thread,'Large synthetic body']
    );
    const saved=await fetchAndCacheThread(pool,owner,{
      mailbox:'direction',thread_id:thread
    },{listMessages:async()=>({
      items:[{id,from:'client@example.invalid',
        to:['owner@example.invalid'],subject:'Large synthetic body',
        text:content,created_at:'2026-11-11T10:00:00Z'}],
      has_more:false
    })});
    assert.equal(saved.items.length,1);
    const before=(await pool.query(
      'SELECT body_text FROM enkyron_mail_local_messages WHERE workspace_key=$1',
      [scope]
    )).rows[0].body_text;
    assert.match(before,/Full message exceeds preview limit/);
    assert.equal(before.includes(content),false);
    const archived=await archiveNextMailBatch(pool,owner,{mailbox:'direction'},{
      getDetails:async()=>({id,mailbox:'direction',thread_id:thread,
        direction:'inbound',from:'client@example.invalid',
        to:['owner@example.invalid'],cc:[],bcc:[],reply_to:[],
        text:content,html:null,attachments:[],attachments_known:true})
    });
    assert.equal(archived.archived,1);
    const result=await localMailMessages(pool,owner,{
      mailbox:'direction',thread_id:thread
    });
    assert.equal(result.items[0].text.length,20000);
    assert.equal(result.items[0].preview_truncated,true);
    assert.equal(result.items[0].archive_state,'body_captured');
    assert.equal((await pool.query(
      'SELECT length(body_text_full)::int AS n FROM enkyron_mail_full_messages '+
      'WHERE workspace_key=$1',[scope]
    )).rows[0].n,25000);
  }finally{await pool.end();}
});

test('read and unread transitions persist without forging unsupported schema 112 audit events',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-local-read-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID();
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject,unread) '+
      "VALUES($1,'direction',$2,'inbox','inbox','Unread case',TRUE)",
      [scope,thread]
    );
    const target={mailbox:'direction',thread_id:thread};
    const read=await setLocalThreadRead(pool,owner,{...target,unread:false});
    assert.deepEqual(read,{unread:false,changed:true,provider_unchanged:true});
    const repeat=await setLocalThreadRead(pool,owner,{...target,unread:false});
    assert.equal(repeat.changed,false);
    const unread=await setLocalThreadRead(pool,owner,{...target,unread:true});
    assert.equal(unread.changed,true);
    assert.equal((await localMailList(pool,owner,{
      mailbox:'direction',folder:'inbox'
    })).items[0].unread,true);
    const audit=(await pool.query(
      'SELECT event_kind FROM enkyron_mail_local_events '+
      'WHERE workspace_key=$1 ORDER BY occurred_at',[scope]
    )).rows.map(row=>row.event_kind);
    assert.deepEqual(audit,[]); // No fabricated event kind allowed in schema 112.
    await assert.rejects(setLocalThreadRead(pool,owner,{
      ...target,unread:'yes'
    }),/Invalid local Mail unread state/);
    await assert.rejects(setLocalThreadRead(pool,owner,{
      mailbox:'support',thread_id:thread,unread:false
    }),/Mail thread not found/);
  }finally{await pool.end();}
});

test('failed support folder remains in cursor continuation until recovered',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-partial-retry-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,id=crypto.randomUUID();
  const attempts=[];
  const listThreads=async(_pool,_actor,mailbox,folder,after=null)=>{
    attempts.push([mailbox,folder,after]);
    if(mailbox==='support'&&folder==='inbox'&&attempts.filter(
      row=>row[0]==='support'&&row[1]==='inbox').length===1)
      throw Error('Synthetic read timeout');
    return {items:mailbox==='support'&&folder==='inbox'?[{
      id,subject:'Recovered support',last_message_at:'2026-11-11T15:00:00Z'
    }]:[],has_more:false};
  };
  try{
    const first=await syncMailHeaders(pool,owner,{mailbox:'all'},{listThreads});
    assert.equal(first.partial,true);
    assert.ok(first.unavailable.includes('support/inbox'));
    assert.equal(first.more_pending,true);
    assert.ok(Object.hasOwn(first.continuation,'support/inbox'));
    assert.equal(first.continuation['support/inbox'],null);
    const second=await syncMailHeaders(pool,owner,{
      mailbox:'all',cursors:first.continuation
    },{listThreads});
    assert.equal(second.partial,false);
    assert.equal(second.more_pending,false);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1',[scope])).rows[0].n,1);
    assert.deepEqual(attempts.filter(
      row=>row[0]==='support'&&row[1]==='inbox').map(x=>x[2]),[null,null]);
  }finally{await pool.end();}
});


test('folder rename and empty-delete preserve mail without unsupported audit kinds',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-folder-life-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID();
  try{
    const folder=await createLocalMailFolder(pool,owner,{name:'First Name'});
    const renamed=await renameLocalMailFolder(pool,owner,{
      folder:folder.key,name:'Client Support'
    });
    assert.equal(renamed.changed,true);
    assert.equal(renamed.key,folder.key);
    assert.ok((await localMailFolders(pool,owner)).folders.some(
      row=>row.key===folder.key&&row.name==='Client Support'));
    assert.equal((await renameLocalMailFolder(pool,owner,{
      folder:folder.key,name:'Client Support'
    })).changed,false);
    await assert.rejects(renameLocalMailFolder(pool,owner,{
      folder:'inbox',name:'Not allowed'
    }),/System Mail folders/);
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox',$3,'Synthetic folder mail')",
      [scope,thread,folder.key]
    );
    await assert.rejects(deleteEmptyLocalMailFolder(pool,owner,{
      folder:folder.key
    }),/Move saved messages/);
    assert.equal((await localMailList(pool,owner,{folder:folder.key})).items.length,1);
    await moveLocalThread(pool,owner,{
      mailbox:'direction',thread_id:thread,folder:'inbox'
    });
    const deleted=await deleteEmptyLocalMailFolder(pool,owner,{folder:folder.key});
    assert.equal(deleted.deleted,true);
    assert.equal(deleted.mail_unchanged,true);
    assert.equal((await localMailList(pool,owner,{folder:'inbox'})).items.length,1);
    assert.ok(!(await localMailFolders(pool,owner)).folders.some(
      row=>row.key===folder.key));
    const events=(await pool.query(
      'SELECT event_kind FROM enkyron_mail_local_events '+
      'WHERE workspace_key=$1 ORDER BY occurred_at',[scope]
    )).rows.map(row=>row.event_kind);
    assert.deepEqual(events,['folder_created','thread_moved']);
  }finally{await pool.end();}
});


test('automatic Inbox poll uses GET-only pages and refreshes existing threads idempotently',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-mail-auto-'+crypto.randomUUID().slice(0,8);
  const scope='local:'+owner,thread=crypto.randomUUID();
  const message1=crypto.randomUUID(),message2=crypto.randomUUID();
  const providerCalls=[];
  let last='2026-11-11T16:00:00Z';
  let messages=[{
    id:message1,from:'gmail@example.invalid',to:['direction@example.invalid'],
    subject:'Synthetic Gmail test',text:'Hello, automatic Inbox',
    created_at:last,html_only:false
  }];
  const listThreads=async(_pool,_actor,mailbox,folder,after=null)=>{
    providerCalls.push(['GET','threads',mailbox,folder,after]);
    assert.equal(folder,'inbox');
    return {items:mailbox==='direction'?[{
      id:thread,subject:'Synthetic Gmail test',last_message_at:last,
      unread:true
    }]:[],has_more:false};
  };
  const listMessages=async(_pool,_actor,mailbox,id,after=null)=>{
    providerCalls.push(['GET','messages',mailbox,id,after]);
    assert.equal(mailbox,'direction');
    assert.equal(id,thread);
    return {items:messages,has_more:false};
  };
  try{
    const first=await syncMailHeaders(pool,owner,{
      mailbox:'all',inbox_only:true
    },{listThreads});
    assert.equal(first.new_threads,1);
    assert.equal(first.updated_threads,0);
    assert.equal(first.partial,false);
    assert.equal(providerCalls.filter(x=>x[1]==='threads').length,2);
    const cached=await syncLocalMailBodies(pool,owner,{
      mailbox:'all',recent:true
    },{listMessages});
    assert.equal(cached.cached_threads,1);
    assert.equal(cached.failed_threads,0);
    const repeat=await syncMailHeaders(pool,owner,{
      mailbox:'all',inbox_only:true
    },{listThreads});
    assert.equal(repeat.new_threads,0);
    assert.equal(repeat.updated_threads,0);
    // A new Gmail reply to an existing thread must be imported too.
    last='2026-11-11T16:05:00Z';
    messages.push({
      id:message2,from:'gmail@example.invalid',to:['direction@example.invalid'],
      subject:'Re: Synthetic Gmail test',text:'Second message in the same thread',
      created_at:last,html_only:false
    });
    const newer=await syncMailHeaders(pool,owner,{
      mailbox:'all',inbox_only:true
    },{listThreads});
    assert.equal(newer.new_threads,0);
    assert.equal(newer.updated_threads,1);
    await syncLocalMailBodies(pool,owner,{mailbox:'all',recent:true},{listMessages});
    await syncLocalMailBodies(pool,owner,{mailbox:'all',recent:true},{listMessages});
    const unique=(await pool.query(
      'SELECT count(*)::int AS total, '+
      'count(DISTINCT message_id)::int AS distinct_messages '+
      'FROM enkyron_mail_local_messages WHERE workspace_key=$1',[scope]
    )).rows[0];
    assert.equal(unique.total,2);
    assert.equal(unique.distinct_messages,2);
    assert.equal((await localMailMessages(pool,owner,{
      mailbox:'direction',thread_id:thread
    })).items.length,2);
    assert.ok(providerCalls.every(x=>x[0]==='GET'));
    await assert.rejects(syncMailHeaders(pool,owner,{
      mailbox:'all',inbox_only:'true'
    },{listThreads}),/Invalid Mail inbox poll/);
    await assert.rejects(syncLocalMailBodies(pool,owner,{
      mailbox:'all',recent:'yes'
    },{listMessages}),/Invalid Mail recent poll/);
  }finally{await pool.end();}
});


test('schema 113 archives full mail and quarantines attachment metadata idempotently',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-mail-archive-'+crypto.randomUUID().slice(0,8);
  const workspace='local:'+owner,thread=crypto.randomUUID();
  const id=crypto.randomUUID(),attachment=crypto.randomUUID();
  let providerCalls=0;
  const getDetails=async(_pool,_actor,mailbox,threadId,messageId)=>{
    providerCalls++;
    assert.equal(mailbox,'direction');
    assert.equal(threadId,thread);
    assert.equal(messageId,id);
    return {
      id,mailbox,thread_id:thread,rfc_message_id:'<synthetic@example.invalid>',
      direction:'inbound',from:'sender@example.invalid',
      to:['direction@agentrisklayer.com'],cc:[],bcc:[],reply_to:[],
      text:'LONG-'.repeat(5000),html:'<img src="https://tracker.invalid/x">',
      attachments:[{
        id:attachment,filename:'invoice.pdf',
        content_type:'application/pdf',size:1234
      }]
    };
  };
  try{
    const ready=(await pool.query(
      "SELECT to_regclass('enkyron_mail_full_messages') IS NOT NULL AS ok"
    )).rows[0].ok;
    assert.equal(ready,true,'CI migrator must apply additive schema 113');
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox','inbox','Archive test')",
      [workspace,thread]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,sender,subject,body_text) '+
      "VALUES($1,'direction',$2,$3,'sender@example.invalid','Archive test','Short preview')",
      [workspace,thread,id]
    );
    const first=await archiveNextMailBatch(pool,owner,{mailbox:'direction'},{getDetails});
    assert.equal(first.available,true);
    assert.equal(first.archived,1);
    assert.equal(first.attachments_metadata,1);
    assert.equal(first.failed,0);
    const second=await archiveNextMailBatch(pool,owner,{mailbox:'direction'},{getDetails});
    assert.equal(second.archived,0);
    assert.equal(providerCalls,1); // no provider re-fetch of archived message
    const full=(await pool.query(
      'SELECT body_text_full,body_html_inert,provider_sha256,archive_state '+
      'FROM enkyron_mail_full_messages WHERE workspace_key=$1',[workspace]
    )).rows;
    assert.equal(full.length,1);
    assert.equal(full[0].body_text_full.length,25000);
    assert.equal(full[0].archive_state,'body_captured');
    assert.match(full[0].body_html_inert,/tracker.invalid/);
    assert.match(full[0].provider_sha256,/^[0-9a-f]{64}$/);
    const unsafe=(await pool.query(
      'SELECT original_filename,content_type,declared_size,content_bytes,'+
      'content_sha256,safety_state FROM enkyron_mail_attachment_quarantine '+
      'WHERE workspace_key=$1',[workspace]
    )).rows;
    assert.equal(unsafe.length,1);
    assert.equal(unsafe[0].original_filename,'invoice.pdf');
    assert.equal(unsafe[0].content_bytes,null);
    assert.equal(unsafe[0].content_sha256,null);
    assert.equal(unsafe[0].safety_state,'metadata_only');
    const status=await mailArchiveStatus(pool,owner,{mailbox:'direction'});
    assert.equal(status.available,true);
    assert.equal(status.cached,1);
    assert.equal(status.body_captured,1);
    assert.equal(status.quarantined_metadata,1);
    assert.equal((await pool.query(
      'SELECT body_text FROM enkyron_mail_local_messages '+
      'WHERE workspace_key=$1',[workspace]
    )).rows[0].body_text,'Short preview'); // historical table untouched
    const fullRead=await readArchivedFullText(pool,owner,{
      mailbox:'direction',thread_id:thread,message_id:id
    });
    assert.equal(fullRead.available,true);
    assert.equal(fullRead.text.length,25000);
    assert.equal(fullRead.archive_state,'body_captured');
    assert.equal(fullRead.mailbox,'direction');
    assert.equal(fullRead.message_id,id);
    assert.equal(Object.hasOwn(fullRead,'body_html_inert'),false);
    assert.equal(Object.hasOwn(fullRead,'attachment_bytes'),false);
    await assert.rejects(readArchivedFullText(pool,'another-user',{
      mailbox:'direction',thread_id:thread,message_id:id
    }),/Archived Mail message not found/);
    await assert.rejects(readArchivedFullText(pool,owner,{
      mailbox:'support',thread_id:thread,message_id:id
    }),/Archived Mail message not found/);
    await assert.rejects(readArchivedFullText(pool,owner,{
      mailbox:'direction',thread_id:thread,message_id:'bad'
    }),/Invalid Mail identifier/);
    const other=await mailArchiveStatus(pool,'another-user');
    assert.equal(other.body_captured,0);
  }finally{await pool.end();}
});

test('schema 113 rejects untrusted archive payload without false full-content claims',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-mail-archive-refuse-'+crypto.randomUUID().slice(0,8);
  const workspace='local:'+owner,thread=crypto.randomUUID();
  const id=crypto.randomUUID(),attachment=crypto.randomUUID();
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox','inbox','Safe check')",
      [workspace,thread]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,sender,subject,body_text) '+
      "VALUES($1,'direction',$2,$3,'client@example.invalid','Safe check','preview')",
      [workspace,thread,id]
    );
    const wrong=await archiveNextMailBatch(pool,owner,{},{
      getDetails:async()=>({id:attachment,mailbox:'direction',thread_id:thread})
    });
    assert.equal(wrong.failed,1);
    assert.equal(wrong.archived,0);
    const corrupt=await archiveNextMailBatch(pool,owner,{},{
      getDetails:async()=>({
        id,mailbox:'direction',thread_id:thread,
        text:'original',html:null,from:'client@example.invalid',
        to:[],cc:[],bcc:[],reply_to:[],
        attachments:[{id:attachment,filename:'a.pdf',size:999999999}]
      })
    });
    assert.equal(corrupt.failed,1);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_full_messages WHERE workspace_key=$1',
      [workspace]
    )).rows[0].n,0);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_attachment_quarantine '+
      'WHERE workspace_key=$1',[workspace]
    )).rows[0].n,0);
  }finally{await pool.end();}
});


test('attachment bytes enter NEMORYTH quarantine with hash and no release path',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const owner='ci-mail-bytes-'+crypto.randomUUID().slice(0,8);
  const workspace='local:'+owner,thread=crypto.randomUUID();
  const message=crypto.randomUUID(),attachment=crypto.randomUUID();
  const bytes=Buffer.from('%PDF-1.4\nsynthetic inert fixture\n','utf8');
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const target={mailbox:'direction',message_id:message,attachment_id:attachment};
  try{
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,subject) '+
      "VALUES($1,'direction',$2,'inbox','inbox','Quarantine synthetic')",
      [workspace,thread]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_messages '+
      '(workspace_key,mailbox_key,thread_id,message_id,sender,subject,body_text) '+
      "VALUES($1,'direction',$2,$3,'client@example.invalid','Quarantine','Preview')",
      [workspace,thread,message]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_attachment_quarantine '+
      '(workspace_key,mailbox_key,message_id,attachment_id,'+
      'original_filename,content_type,declared_size,safety_state) '+
      "VALUES($1,'direction',$2,$3,'test.pdf','application/pdf',$4,'metadata_only')",
      [workspace,message,attachment,bytes.length]
    );
    await assert.rejects(quarantineAttachmentBytes(pool,owner,{
      ...target,bytes:Buffer.from('wrong bytes')
    }),/size differs/);
    await assert.rejects(quarantineAttachmentBytes(pool,'other-owner',{
      ...target,bytes
    }),/manifest not found/);
    await assert.rejects(quarantineAttachmentBytes(pool,owner,{
      ...target,bytes,expected_sha256:'0'.repeat(64)
    }),/digest mismatch/);
    const first=await quarantineAttachmentBytes(pool,owner,{
      ...target,bytes,expected_sha256:digest
    });
    assert.equal(first.already_present,false);
    assert.equal(first.safety_state,'quarantined_unscanned');
    assert.equal(first.sha256,digest);
    const repeated=await quarantineAttachmentBytes(pool,owner,{...target,bytes});
    assert.equal(repeated.already_present,true);
    const row=(await pool.query(
      'SELECT content_bytes,content_sha256,safety_state FROM '+
      'enkyron_mail_attachment_quarantine WHERE workspace_key=$1',
      [workspace]
    )).rows[0];
    assert.deepEqual(row.content_bytes,bytes);
    assert.equal(row.content_sha256,digest);
    assert.equal(row.safety_state,'quarantined_unscanned');
    assert.equal(Object.hasOwn(first,'content_bytes'),false);
    assert.equal(Object.hasOwn(repeated,'content_bytes'),false);
    assert.equal((await mailArchiveStatus(pool,owner)).quarantined_metadata,1);
    await assert.rejects(quarantineAttachmentBytes(pool,owner,{
      ...target,bytes:Buffer.alloc(26214401)
    }),/Invalid attachment quarantine bytes/);
    await pool.query(
      'UPDATE enkyron_mail_attachment_quarantine '+
      "SET safety_state='blocked' WHERE workspace_key=$1",
      [workspace]
    );
    await assert.rejects(quarantineAttachmentBytes(pool,owner,{
      ...target,bytes
    }),/Attachment is blocked/);
  }finally{await pool.end();}
});


test('Mail E04-04 company link uses existing schema 112 field, never sends or changes tickets',{
  skip:!url&&'Disposable PostgreSQL CI only'
},async()=>{
  const pool=new pg.Pool({connectionString:ciConnection(),max:2});
  const actor='ci-mail-crm-'+crypto.randomUUID().slice(0,8);
  const key='local:'+actor;
  const thread=crypto.randomUUID(),company=crypto.randomUUID();
  const second=crypto.randomUUID();
  try{
    await pool.query(
      'INSERT INTO enkyron_local_mail_access '+
      '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
      "VALUES($1,'direction','organization_owner_l5',TRUE,FALSE,$2)",
      [key,actor]
    );
    await pool.query(
      'INSERT INTO enkyron_mail_local_threads '+
      "(workspace_key,mailbox_key,thread_id,folder_key,subject) "+
      "VALUES($1,'direction',$2,'inbox','Reviewed incoming request')",
      [key,thread]
    );
    await pool.query(
      'INSERT INTO enkyron_crm_companies '+
      '(id,workspace_key,name,owner_local) VALUES($1,$2,$3,$4)',
      [company,key,'Synthetic Company',actor]
    );
    await pool.query(
      'INSERT INTO enkyron_crm_companies '+
      "(id,workspace_key,name,owner_local,relationship_state) "+
      "VALUES($1,$2,$3,$4,'inactive')",
      [second,key,'Inactive synthetic client',actor]
    );
    const source={mailbox:'direction',thread_id:thread};
    assert.equal((await localMailCompanyLink(pool,actor,source)).linked,false);
    await assert.rejects(linkLocalMailCompany(pool,actor,{
      ...source,company_id:company,confirmed:false
    }),/confirmation/);
    await assert.rejects(linkLocalMailCompany(pool,actor,{
      ...source,company_id:second,confirmed:true
    }),/inactive/);
    const result=await linkLocalMailCompany(pool,actor,{
      ...source,company_id:company,confirmed:true
    });
    assert.equal(result.linked,true);
    assert.equal(result.company_id,company);
    assert.equal(result.provider_unchanged,true);
    const after=await localMailCompanyLink(pool,actor,source);
    assert.equal(after.company_id,company);
    assert.equal(after.company_name,'Synthetic Company');
    await assert.rejects(linkLocalMailCompany(pool,actor,{
      ...source,company_id:second,confirmed:true
    }),/already linked/);
    await assert.rejects(localMailCompanyLink(pool,'ci-other-user',source),
      /permission/);
    const saved=(await pool.query(
      'SELECT crm_company_id::text AS company FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3',
      [key,'direction',thread]
    )).rows[0];
    assert.equal(saved.company,company);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM enkyron_mail_send_attempts '+
      'WHERE workspace_key=$1',[key]
    )).rows[0].count,0);
  }finally{await pool.end();}
});
