// Local-first ENKYRON Mail organization. Resend is transport-only.
// No provider folder mutation, deletion, implicit send, or HTML rendering.
import {randomUUID} from 'node:crypto';
import {mailThreads,mailMessages} from './enkyron-mail-service.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAILBOXES=['direction','support'],PROVIDER=['inbox','archive','spam','trash'];
const SYSTEM=['inbox','sent','drafts','archive','spam','trash'];
function scope(owner){
  if(typeof owner!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(owner))
    throw Error('Invalid Mail operator');
  return 'local:'+owner;
}
function safeText(s,max){
  if(typeof s!=='string'||s.length>max||/[\u0000-\u001f\u007f]/.test(s))
    throw Error('Invalid local Mail text');
  return s.trim();
}
function requireUuid(x){if(typeof x!=='string'||!UUID.test(x))throw Error('Invalid Mail identifier');return x;}
function requireMailbox(x){if(!MAILBOXES.includes(x))throw Error('Invalid Mail mailbox');return x;}
function requireFolderKey(key){
  if(typeof key!=='string'||!(/^[a-z0-9_-]{1,64}$/).test(key))
    throw Error('Invalid Mail folder');
  return key;
}
function checkTarget(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid Mail selection');
  return {mailbox:requireMailbox(input.mailbox),thread:requireUuid(input.thread_id)};
}
async function audit(client,key,actor,kind,detail={},mailbox=null,thread=null){
  await client.query(
    'INSERT INTO enkyron_mail_local_events '+
    '(id,workspace_key,mailbox_key,thread_id,event_kind,actor_local,detail) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [randomUUID(),key,mailbox,thread,kind,actor,JSON.stringify(detail)]
  );
}
async function withTransaction(pool,action){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const value=await action(client);
    await client.query('COMMIT');
    return value;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
export async function localMailFolders(pool,actor){
  const key=scope(actor);
  const rows=(await pool.query(
    'SELECT folder_key,name FROM enkyron_mail_local_folders '+
    'WHERE workspace_key=$1 ORDER BY name ASC',[key])).rows;
  return {folders:[
    ...SYSTEM.map(name=>({key:name,name:name[0].toUpperCase()+name.slice(1),system:true})),
    ...rows.map(x=>({key:x.folder_key,name:x.name,system:false}))
  ]};
}
export async function createLocalMailFolder(pool,actor,input){
  const key=scope(actor),name=safeText(input?.name,80);
  if(!name||name.length>80||SYSTEM.some(x=>x.toLowerCase()===name.toLowerCase()))
    throw Error('Invalid local Mail folder name');
  const code='user_'+randomUUID().replaceAll('-','');
  return withTransaction(pool,async c=>{
    await c.query('INSERT INTO enkyron_mail_local_folders '+
      '(workspace_key,folder_key,name) VALUES($1,$2,$3)',[key,code,name]);
    await audit(c,key,actor,'folder_created',{folder_key:code});
    return {key:code,name};
  });
}
export async function localMailList(pool,actor,input={}){
  const key=scope(actor),folder=requireFolderKey(input.folder||'inbox');
  const mailbox=input.mailbox||'all';
  if(mailbox!=='all')requireMailbox(mailbox);
  const search=String(input.search||'').trim();
  if(search.length>120||/[\u0000-\u001f\u007f]/.test(search))
    throw Error('Invalid Mail search');
  // "all" is for an explicit operator search, never the default folder view.
  if(folder==='all'&&!search)throw Error('A search term is required across folders');
  const page=input.page??0;
  if(!Number.isSafeInteger(page)||page<0||page>1000)
    throw Error('Invalid Mail page');
  const rows=(await pool.query(
    'SELECT t.mailbox_key AS mailbox,t.thread_id AS id,t.subject,'+
    'COALESCE(last_mail.sender, \'\') AS sender,'+
    't.last_message_at,t.unread,t.flagged,t.folder_key,t.provider_folder,'+
    "COALESCE(string_agg(DISTINCT l.name, ', '), '') AS labels "+
    'FROM enkyron_mail_local_threads t LEFT JOIN enkyron_mail_thread_labels tl '+
    'ON tl.workspace_key=t.workspace_key AND tl.mailbox_key=t.mailbox_key '+
    'AND tl.thread_id=t.thread_id LEFT JOIN enkyron_mail_local_labels l '+
    'ON l.workspace_key=tl.workspace_key AND l.label_id=tl.label_id '+
    'LEFT JOIN LATERAL (SELECT m.sender FROM enkyron_mail_local_messages m '+
    'WHERE m.workspace_key=t.workspace_key AND m.mailbox_key=t.mailbox_key '+
    'AND m.thread_id=t.thread_id ORDER BY m.created_at DESC LIMIT 1) '+
    'last_mail ON TRUE '+
    'WHERE t.workspace_key=$1 AND ($2::text=\'all\' OR t.folder_key=$2) '+
    'AND ($3::text=\'all\' OR t.mailbox_key=$3) '+
    'AND ($4::text=\'\' OR '+
    'POSITION(LOWER($4) IN LOWER(t.subject))>0 OR '+
    'EXISTS (SELECT 1 FROM enkyron_mail_local_messages m '+
    'WHERE m.workspace_key=t.workspace_key AND m.mailbox_key=t.mailbox_key '+
    'AND m.thread_id=t.thread_id AND ('+
    'POSITION(LOWER($4) IN LOWER(m.sender))>0 OR '+
    'POSITION(LOWER($4) IN LOWER(m.subject))>0 OR '+
    'POSITION(LOWER($4) IN LOWER(m.recipients::text))>0 OR '+
    'POSITION(LOWER($4) IN LOWER(m.body_text))>0)) OR '+
    'EXISTS (SELECT 1 FROM enkyron_mail_thread_labels tl2 '+
    'JOIN enkyron_mail_local_labels l2 '+
    'ON l2.workspace_key=tl2.workspace_key AND l2.label_id=tl2.label_id '+
    'WHERE tl2.workspace_key=t.workspace_key AND tl2.mailbox_key=t.mailbox_key '+
    'AND tl2.thread_id=t.thread_id AND '+
    'POSITION(LOWER($4) IN LOWER(l2.name))>0)) '+
    'GROUP BY t.mailbox_key,t.thread_id,t.subject,last_mail.sender,'+
    't.last_message_at,t.unread,t.flagged,t.folder_key,t.provider_folder '+
    'ORDER BY t.last_message_at DESC,t.mailbox_key,t.thread_id LIMIT 51 OFFSET $5',
    [key,folder,mailbox,search,page*50]
  )).rows;
  return {mailbox,folder,search,page,items:rows.slice(0,50),
    has_more:rows.length>50,source:'local'};
}
// One provider page per mailbox/folder and call. Each successful page commits
// independently, so interruption never rolls back other inboxes or folders.
// Callers carry the returned cursors forward; restarting from page one is safe
// because existing PostgreSQL keys are idempotent.
export async function syncMailHeaders(pool,actor,input={},{
  listThreads=mailThreads
}={}){
  const key=scope(actor),chosen=input?.mailbox||'all';
  if(chosen!=='all')requireMailbox(chosen);
  const permitted=(chosen==='all'?MAILBOXES:[chosen])
    .flatMap(mailbox=>PROVIDER.map(folder=>({mailbox,folder,
      key:mailbox+'/'+folder})));
  const continuation=input?.cursors;
  if(continuation!==undefined&&(!continuation||typeof continuation!=='object'
      ||Array.isArray(continuation)))throw Error('Invalid Mail pagination state');
  const requested=continuation===undefined?permitted:
    permitted.filter(item=>Object.hasOwn(continuation,item.key));
  if(continuation!==undefined&&Object.keys(continuation).some(
    k=>!permitted.some(item=>item.key===k)
      ||continuation[k]!==null&&!UUID.test(continuation[k])))
    throw Error('Invalid Mail pagination state');
  let imported=0;
  const unavailable=[],next={};
  // Never make more than two simultaneous provider calls.
  for(let offset=0;offset<requested.length;offset+=2){
    const results=await Promise.allSettled(
      requested.slice(offset,offset+2).map(async task=>{
        const after=continuation?.[task.key]??null;
        const page=await listThreads(pool,actor,task.mailbox,task.folder,after);
        if(!page||!Array.isArray(page.items)||typeof page.has_more!=='boolean'
            ||page.items.length>30||(page.has_more&&!page.items.length))
          throw Error('Incomplete Resend Mail page');
        const rows=page.items.map(item=>({
          id:requireUuid(item.id),
          subject:String(item.subject||'').slice(0,400),
          last:String(item.last_message_at||'').slice(0,64),
          unread:item.unread===true
        }));
        const cursor=page.has_more?rows.at(-1).id:null;
        if(page.has_more&&cursor===after)
          throw Error('Resend Mail cursor did not advance');
        await withTransaction(pool,async client=>{
          for(const row of rows){
            await client.query(
              'INSERT INTO enkyron_mail_local_threads '+
              '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,'+
              'subject,last_message_at,unread) '+
              'VALUES($1,$2,$3,$4,$4,$5,$6,$7) '+
              'ON CONFLICT(workspace_key,mailbox_key,thread_id) DO UPDATE SET '+
              'provider_folder=EXCLUDED.provider_folder,'+
              'subject=EXCLUDED.subject,last_message_at=EXCLUDED.last_message_at,'+
              'last_synced=NOW()',
              [key,task.mailbox,row.id,task.folder,row.subject,row.last,row.unread]
            );
          }
        });
        return {task,cursor,count:rows.length};
      })
    );
    for(let i=0;i<results.length;i++){
      const result=results[i],task=requested[offset+i];
      if(result.status==='rejected'){
        unavailable.push(task.key);
        continue;
      }
      imported+=result.value.count;
      if(result.value.cursor)next[task.key]=result.value.cursor;
    }
  }
  if(requested.length&&unavailable.length===requested.length)
    throw Error('Resend Mail sync failed for all selected folders');
  return {synced:true,imported,partial:unavailable.length>0,unavailable,
    continuation:next,more_pending:Object.keys(next).length>0,
    note:'Each completed provider page is saved in PostgreSQL; retries are idempotent.'};
}

// The normal quick pass imports previously uncached threads. The full rescan
// pass is keyset-paginated (not OFFSET) and revisits partial threads, including
// threads already containing some messages. On interruption, start the rescan
// again: ON CONFLICT prevents duplicate messages; no provider data is mutated.
export async function syncLocalMailBodies(pool,actor,input={},{
  listMessages=mailMessages
}={}){
  const key=scope(actor),selected=input?.mailbox||'all';
  if(selected!=='all')requireMailbox(selected);
  if(input?.rescan===true){
    const anchor=input?.after_thread??null,resume=input?.resume??null;
    function pointer(value){
      if(!value||typeof value!=='object'||Array.isArray(value))
        throw Error('Invalid Mail body progress');
      return {mailbox:requireMailbox(value.mailbox),
        thread:requireUuid(value.thread_id)};
    }
    const previous=anchor?pointer(anchor):null;
    const pending=resume?pointer(resume):null;
    if(previous&&selected!=='all'&&previous.mailbox!==selected)
      throw Error('Invalid Mail body progress');
    if(pending&&selected!=='all'&&pending.mailbox!==selected)
      throw Error('Invalid Mail body progress');
    if(resume&&(!UUID.test(resume.after)||!pending))
      throw Error('Invalid Mail body progress');
    let current=pending;
    if(!current){
      const row=(await pool.query(
        'SELECT t.mailbox_key,t.thread_id FROM enkyron_mail_local_threads t '+
        'WHERE t.workspace_key=$1 AND ($2::text=\'all\' OR t.mailbox_key=$2) '+
        'AND ($3::text IS NULL OR (t.mailbox_key,t.thread_id) > '+
        '($3::text,$4::uuid)) '+
        'ORDER BY t.mailbox_key,t.thread_id LIMIT 1',
        [key,selected,previous?.mailbox??null,previous?.thread??null]
      )).rows[0];
      if(!row)return {cached_threads:0,failed_threads:0,
        more_pending:false,requires_safe_html_viewer:0};
      current={mailbox:requireMailbox(row.mailbox_key),
        thread:requireUuid(row.thread_id)};
    }
    let after=resume?.after??null,html=0,pages=0;
    try{
      for(;pages<2;pages++){
        const page=await fetchAndCacheThread(pool,actor,{
          mailbox:current.mailbox,thread_id:current.thread,after
        },{listMessages});
        if(page.items.some(m=>m.html_only===true))html=1;
        if(page.has_more){
          if(!page.next_after||page.next_after===after)
            throw Error('Resend Mail body cursor did not advance');
          after=page.next_after;
          continue;
        }
        const next={mailbox:current.mailbox,thread_id:current.thread};
        const more=(await pool.query(
          'SELECT 1 FROM enkyron_mail_local_threads t '+
          'WHERE t.workspace_key=$1 AND ($2::text=\'all\' OR t.mailbox_key=$2) '+
          'AND (t.mailbox_key,t.thread_id)>($3::text,$4::uuid) LIMIT 1',
          [key,selected,current.mailbox,current.thread]
        )).rows.length>0;
        return {cached_threads:1,failed_threads:0,
          requires_safe_html_viewer:html,more_pending:more,
          continuation:more?{after_thread:next}:null};
      }
      return {cached_threads:1,failed_threads:0,
        requires_safe_html_viewer:html,more_pending:true,
        continuation:{after_thread:previous?{
          mailbox:previous.mailbox,thread_id:previous.thread
        }:null,resume:{mailbox:current.mailbox,thread_id:current.thread,after}}};
    }catch{
      return {cached_threads:0,failed_threads:1,more_pending:true,
        requires_safe_html_viewer:html,
        continuation:{after_thread:previous?{
          mailbox:previous.mailbox,thread_id:previous.thread
        }:null,resume:resume||(
          after?{mailbox:current.mailbox,thread_id:current.thread,after}:null)},
        note:'Body import incomplete. Previously committed pages are preserved.'};
    }
  }
  const candidates=(await pool.query(
    'SELECT t.mailbox_key,t.thread_id FROM enkyron_mail_local_threads t '+
    'WHERE t.workspace_key=$1 AND ($2::text=\'all\' OR t.mailbox_key=$2) '+
    'AND NOT EXISTS (SELECT 1 FROM enkyron_mail_local_messages m '+
    'WHERE m.workspace_key=t.workspace_key AND m.mailbox_key=t.mailbox_key '+
    'AND m.thread_id=t.thread_id) '+
    'ORDER BY t.last_message_at DESC LIMIT $3',
    [key,selected,9]
  )).rows;
  let cached=0,failed=0,html=0;
  for(const row of candidates.slice(0,8)){
    try{
      const page=await fetchAndCacheThread(pool,actor,{
        mailbox:row.mailbox_key,thread_id:row.thread_id
      },{listMessages});
      if(page.items.length)cached++;
      if(page.items.some(m=>m.html_only===true))html++;
    }catch{failed++;}
  }
  return {cached_threads:cached,failed_threads:failed,
    requires_safe_html_viewer:html,
    more_pending:candidates.length>8,
    note:'Use the full rescan to finish previously interrupted conversations.'};
}

export async function localMailMessages(pool,actor,input){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const rows=(await pool.query(
    'SELECT message_id AS id,sender AS "from",recipients AS "to",subject,'+
    'body_text AS text,html_only,created_at FROM enkyron_mail_local_messages '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 '+
    'ORDER BY created_at ASC LIMIT 51',[key,mailbox,thread])).rows;
  return {mailbox,thread_id:thread,items:rows.slice(0,50),
    has_more:rows.length>50,source:'local'};
}

export async function fetchAndCacheThread(pool,actor,input,{
  listMessages=mailMessages
}={}){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const after=input?.after??null;
  if(after!==null)requireUuid(after);
  const exists=(await pool.query(
    'SELECT thread_id FROM enkyron_mail_local_threads WHERE workspace_key=$1 '+
    'AND mailbox_key=$2 AND thread_id=$3',[key,mailbox,thread])).rows[0];
  if(!exists)throw Error('Mail thread not yet indexed locally');
  const response=await listMessages(pool,actor,mailbox,thread,after);
  if(!response||!Array.isArray(response.items)||response.items.length>30
     ||(response.has_more===true&&!response.items.length))
    throw Error('Incomplete Resend Mail body page');
  const items=response.items;
  const last=items.at(-1)?.id??null;
  if(response.has_more===true&&(!UUID.test(last)||last===after))
    throw Error('Resend Mail body cursor did not advance');
  await withTransaction(pool,async client=>{
    for(const item of items){
      const id=requireUuid(item.id);
      const body=String(item.text||'');
      // Existing schema has a 20,000-character field. Do not silently
      // claim an oversized provider message has been preserved in full.
      if(body.length>20000)throw Error('Mail body exceeds local schema limit');
      await client.query(
        'INSERT INTO enkyron_mail_local_messages '+
        '(workspace_key,mailbox_key,thread_id,message_id,sender,recipients,'+
        'subject,body_text,html_only,created_at) '+
        'VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) '+
        'ON CONFLICT(workspace_key,mailbox_key,message_id) DO NOTHING',
        [key,mailbox,thread,id,String(item.from||'').slice(0,254),
          JSON.stringify((item.to||[]).slice(0,20)),
          String(item.subject||'').slice(0,400),body,
          item.html_only===true,String(item.created_at||'').slice(0,64)]
      );
    }
  });
  const local=await localMailMessages(pool,actor,{mailbox,thread_id:thread});
  return {...local,has_more:response.has_more===true,
    next_after:response.has_more===true?last:null,
    cached_page_messages:items.length};
}
export async function moveLocalThread(pool,actor,input){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const target=requireFolderKey(input?.folder);
  if(!SYSTEM.includes(target)){
    const row=(await pool.query('SELECT folder_key FROM enkyron_mail_local_folders '+
      'WHERE workspace_key=$1 AND folder_key=$2',[key,target])).rows[0];
    if(!row)throw Error('Local Mail folder not found');
  }
  return withTransaction(pool,async c=>{
    const changed=await c.query(
      'UPDATE enkyron_mail_local_threads SET folder_key=$4 WHERE workspace_key=$1 '+
      'AND mailbox_key=$2 AND thread_id=$3 AND folder_key<>$4 '+
      'RETURNING folder_key',[key,mailbox,thread,target]);
    if(changed.rowCount!==1)throw Error('Mail thread missing or already in folder');
    await audit(c,key,actor,'thread_moved',{target},mailbox,thread);
    return {moved:true,folder:target,provider_unchanged:true};
  });
}
// Flag is local-only and versioned by the already immutable Mail event log.
export async function flagLocalThread(pool,actor,input){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  if(typeof input.flagged!=='boolean')throw Error('Invalid local Mail flag');
  return withTransaction(pool,async client=>{
    const changed=await client.query(
      'UPDATE enkyron_mail_local_threads SET flagged=$4 '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 '+
      'AND flagged IS DISTINCT FROM $4 RETURNING flagged',
      [key,mailbox,thread,input.flagged]
    );
    if(changed.rowCount===0){
      const found=(await client.query(
        'SELECT flagged FROM enkyron_mail_local_threads WHERE workspace_key=$1 '+
        'AND mailbox_key=$2 AND thread_id=$3',
        [key,mailbox,thread]
      )).rows[0];
      if(!found)throw Error('Mail thread not found');
      return {flagged:found.flagged,changed:false};
    }
    await audit(client,key,actor,
      input.flagged?'thread_flagged':'thread_unflagged',
      {},mailbox,thread);
    return {flagged:input.flagged,changed:true};
  });
}
export async function localMailLabels(pool,actor){
  return {labels:(await pool.query(
    'SELECT label_id AS id,name FROM enkyron_mail_local_labels '+
    'WHERE workspace_key=$1 ORDER BY name ASC',[scope(actor)])).rows};
}
export async function createLocalLabel(pool,actor,input){
  const key=scope(actor),name=safeText(input?.name,50);
  if(!name)throw Error('Invalid local Mail label name');
  return withTransaction(pool,async c=>{
    const id=randomUUID();
    await c.query('INSERT INTO enkyron_mail_local_labels(workspace_key,label_id,name) '+
      'VALUES($1,$2,$3)',[key,id,name]);
    await audit(c,key,actor,'label_created',{label_id:id});
    return {id,name};
  });
}
export async function labelLocalThread(pool,actor,input){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const label=requireUuid(input?.label_id),checked=input?.applied;
  if(typeof checked!=='boolean')throw Error('Invalid local Mail label action');
  return withTransaction(pool,async c=>{
    const found=(await c.query('SELECT label_id FROM enkyron_mail_local_labels '+
      'WHERE workspace_key=$1 AND label_id=$2',[key,label])).rows[0];
    if(!found)throw Error('Local Mail label not found');
    const result=checked?await c.query(
      'INSERT INTO enkyron_mail_thread_labels '+
      '(workspace_key,mailbox_key,thread_id,label_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [key,mailbox,thread,label]
    ):await c.query('DELETE FROM enkyron_mail_thread_labels WHERE '+
      'workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 AND label_id=$4',
      [key,mailbox,thread,label]);
    if(result.rowCount)await audit(c,key,actor,checked?'thread_labeled':'thread_unlabeled',
      {label_id:label},mailbox,thread);
    return {applied:checked,changed:Boolean(result.rowCount)};
  });
}
