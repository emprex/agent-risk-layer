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
  const rows=(await pool.query(
    'SELECT t.mailbox_key AS mailbox,t.thread_id AS id,t.subject,'+
    't.last_message_at,t.unread,t.flagged,t.folder_key,t.provider_folder,'+
    "COALESCE(string_agg(DISTINCT l.name, ', '), '') AS labels "+
    'FROM enkyron_mail_local_threads t LEFT JOIN enkyron_mail_thread_labels tl '+
    'ON tl.workspace_key=t.workspace_key AND tl.mailbox_key=t.mailbox_key '+
    'AND tl.thread_id=t.thread_id LEFT JOIN enkyron_mail_local_labels l '+
    'ON l.workspace_key=tl.workspace_key AND l.label_id=tl.label_id '+
    'WHERE t.workspace_key=$1 AND t.folder_key=$2 '+
    'AND ($3::text=\'all\' OR t.mailbox_key=$3) '+
    "AND ($4::text='' OR t.subject ILIKE '%' || $4 || '%') "+
    'GROUP BY t.mailbox_key,t.thread_id,t.subject,t.last_message_at,t.unread,'+
    't.flagged,t.folder_key,t.provider_folder ORDER BY t.last_message_at DESC LIMIT 51',
    [key,folder,mailbox,search]
  )).rows;
  return {mailbox,folder,items:rows.slice(0,50),has_more:rows.length>50,source:'local'};
}
export async function syncMailHeaders(pool,actor,input,{listThreads=mailThreads}={}){
  const key=scope(actor),chosen=input?.mailbox||'all';
  if(chosen!=='all')requireMailbox(chosen);
  const selected=chosen==='all'?MAILBOXES:[chosen];
  const requests=selected.flatMap(mailbox=>PROVIDER.map(folder=>({mailbox,folder})));
  const results=[];
  // Bounded concurrency of 2 avoids hammering Resend. No destructive action.
  for(let offset=0;offset<requests.length;offset+=2){
    const batch=await Promise.allSettled(requests.slice(offset,offset+2).map(
      async request=>({
        ...request,
        result:await listThreads(pool,actor,request.mailbox,request.folder)
      })
    ));
    results.push(...batch);
  }
  const successes=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(!successes.length)throw Error('Resend Mail sync failed for all selected inboxes');
  let imported=0;
  await withTransaction(pool,async client=>{
    for(const {mailbox,folder,result} of successes){
      for(const item of result.items.slice(0,30)){
        const id=requireUuid(item.id);
        await client.query(
          'INSERT INTO enkyron_mail_local_threads '+
          '(workspace_key,mailbox_key,thread_id,provider_folder,folder_key,'+
          'subject,last_message_at,unread) '+
          'VALUES($1,$2,$3,$4,$4,$5,$6,$7) '+
          'ON CONFLICT(workspace_key,mailbox_key,thread_id) DO UPDATE SET '+
          'provider_folder=EXCLUDED.provider_folder,'+
          'subject=EXCLUDED.subject,last_message_at=EXCLUDED.last_message_at,'+
          'last_synced=NOW()',
          [key,mailbox,id,folder,String(item.subject||'').slice(0,400),
            String(item.last_message_at||'').slice(0,64),item.unread===true]
        );
        imported++;
      }
    }
  });
  return {synced:true,imported,partial:successes.length!==requests.length,
    unavailable:requests.filter((_,i)=>results[i].status!=='fulfilled')
      .map(x=>x.mailbox+'/'+x.folder)};
}
export async function localMailMessages(pool,actor,input){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const rows=(await pool.query(
    'SELECT message_id AS id,sender AS "from",recipients AS "to",subject,'+
    'body_text AS text,html_only,created_at FROM enkyron_mail_local_messages '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 '+
    'ORDER BY created_at ASC LIMIT 50',[key,mailbox,thread])).rows;
  return {mailbox,thread_id:thread,items:rows,source:'local'};
}
export async function fetchAndCacheThread(pool,actor,input,{listMessages=mailMessages}={}){
  const key=scope(actor),{mailbox,thread}=checkTarget(input);
  const exists=(await pool.query(
    'SELECT thread_id FROM enkyron_mail_local_threads WHERE workspace_key=$1 '+
    'AND mailbox_key=$2 AND thread_id=$3',[key,mailbox,thread])).rows[0];
  if(!exists)throw Error('Mail thread not yet indexed locally');
  const response=await listMessages(pool,actor,mailbox,thread);
  const items=(response.items||[]).slice(0,30);
  await withTransaction(pool,async client=>{
    for(const item of items){
      if(!UUID.test(item.id))continue;
      await client.query(
        'INSERT INTO enkyron_mail_local_messages '+
        '(workspace_key,mailbox_key,thread_id,message_id,sender,recipients,'+
        'subject,body_text,html_only,created_at) '+
        'VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) '+
        'ON CONFLICT(workspace_key,mailbox_key,message_id) DO NOTHING',
        [key,mailbox,thread,item.id,String(item.from||'').slice(0,254),
          JSON.stringify((item.to||[]).slice(0,20)),String(item.subject||'').slice(0,400),
          String(item.text||'').slice(0,20000),item.html_only===true,
          String(item.created_at||'').slice(0,64)]
      );
    }
  });
  return localMailMessages(pool,actor,{mailbox,thread_id:thread});
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
