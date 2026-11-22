// ENKYRON Calendar: operator-owned local appointments and tasks.
// No external calendar invitations, auto-send, or invented assignees.
import {randomUUID,createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid calendar operator');
  return 'local:'+actor;
}
function textValue(x,max){
  if(typeof x!=='string'||x.trim().length<1||x.length>max
      ||/[\u0000-\u001f\u007f]/.test(x))
    throw Error('Invalid calendar text');
  return x.trim();
}
function iso(value){
  if(typeof value!=='string'||value.length>40||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    throw Error('Invalid calendar timestamp');
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw Error('Invalid calendar timestamp');
  return new Date(ms).toISOString();
}
export function validateCalendarEvent(input){
  const title=textValue(input?.title,200);
  const start=iso(input?.starts_at),end=iso(input?.ends_at);
  if(Date.parse(end)<=Date.parse(start)
     ||Date.parse(end)-Date.parse(start)>14*86400000)
    throw Error('Invalid calendar interval');
  const tz=input?.timezone||'Europe/London';
  if(typeof tz!=='string'||tz.length>64)
    throw Error('Invalid calendar timezone');
  try{new Intl.DateTimeFormat('en-GB',{timeZone:tz});}
  catch{throw Error('Invalid calendar timezone');}
  const location=input?.location||'',notes=input?.notes||'';
  if(typeof location!=='string'||location.length>254||
     typeof notes!=='string'||notes.length>4000)
    throw Error('Invalid calendar description');
  return {title,starts_at:start,ends_at:end,timezone:tz,location,notes};
}
export async function calendarList(pool,actor,input={}){
  const key=scope(actor);
  const start=iso(input.start),end=iso(input.end);
  if(Date.parse(end)<=Date.parse(start)||
     Date.parse(end)-Date.parse(start)>93*86400000)
    throw Error('Invalid calendar query interval');
  const [events,tasks]=await Promise.all([
    pool.query(
      'SELECT event_id AS id,title,starts_at,ends_at,timezone,location,notes,'+
      'crm_company_id FROM enkyron_calendar_events WHERE workspace_key=$1 '+
      'AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at ASC LIMIT 500',
      [key,start,end]
    ),
    pool.query(
      'SELECT task_id AS id,title,due_at,completed_at,crm_company_id,notes '+
      'FROM enkyron_calendar_tasks WHERE workspace_key=$1 '+
      'AND (due_at IS NULL OR (due_at>=$2 AND due_at<$3)) '+
      'ORDER BY due_at ASC NULLS LAST LIMIT 300',
      [key,start,end]
    )
  ]);
  // Read-only projection of the canonical CRM follow-ups. Never create a
  // second Calendar task: the CRM follow-up ID and company scope stay intact.
  // The CRM due date is a London calendar DATE, not an invented timestamp.
  let followups={rows:[]},followupsAvailable=true;
  try{
    followups=await pool.query(
      'SELECT f.id,f.company_id,c.name AS company_name,f.action_text,'+
      'f.due_date::text AS due_date,f.status,f.version '+
      'FROM enkyron_crm_company_followups f '+
      'JOIN enkyron_crm_companies c ON c.workspace_key=f.workspace_key '+
      'AND c.id=f.company_id '+
      "WHERE f.workspace_key=$1 AND f.status='open' "+
      "AND f.due_date>=($2::timestamptz AT TIME ZONE 'Europe/London')::date "+
      "AND f.due_date<($3::timestamptz AT TIME ZONE 'Europe/London')::date "+
      'ORDER BY f.due_date,f.id LIMIT 201',
      [key,start,end]
    );
  }catch(error){
    if(error?.code!=='42P01')throw error;
    // Older installations may not yet have the separate CRM schema 105.
    // Keep the existing Calendar usable and report the missing projection.
    followupsAvailable=false;
  }
  return {
    events:events.rows,tasks:tasks.rows,
    company_followups:followups.rows.slice(0,200),
    company_followups_more:followups.rows.length>200,
    company_followups_available:followupsAvailable
  };
}
export async function calendarCreate(pool,actor,input){
  const key=scope(actor),data=validateCalendarEvent(input),id=randomUUID();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO enkyron_calendar_events '+
      '(workspace_key,event_id,title,starts_at,ends_at,timezone,location,notes) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [key,id,data.title,data.starts_at,data.ends_at,data.timezone,
       data.location,data.notes]
    );
    await client.query(
      'INSERT INTO enkyron_mail_local_events '+
      '(id,workspace_key,event_kind,actor_local,detail) '+
      "VALUES($1,$2,'calendar_created',$3,$4::jsonb)",
      [randomUUID(),key,actor,JSON.stringify({event_id:id})]
    );
    await client.query('COMMIT');
    return {id,...data};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
export async function calendarCreateTask(pool,actor,input){
  const key=scope(actor),title=textValue(input?.title,200),
    due=input?.due_at?iso(input.due_at):null,id=randomUUID();
  const notes=input?.notes??'';
  if(typeof notes!=='string'||notes.length>4000||notes.includes('\u0000'))
    throw Error('Invalid calendar task notes');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO enkyron_calendar_tasks(workspace_key,task_id,title,due_at,notes) '+
      'VALUES($1,$2,$3,$4,$5)',[key,id,title,due,notes]
    );
    await client.query(
      'INSERT INTO enkyron_mail_local_events '+
      '(id,workspace_key,event_kind,actor_local,detail) '+
      "VALUES($1,$2,'task_created',$3,$4::jsonb)",
      [randomUUID(),key,actor,JSON.stringify({task_id:id})]
    );
    await client.query('COMMIT');
    return {id,title,due_at:due,notes};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
export async function calendarCompleteTask(pool,actor,input){
  const key=scope(actor),id=input?.id;
  if(typeof id!=='string'||!UUID.test(id))throw Error('Invalid calendar task ID');
  if(input?.completed!==true)throw Error('Calendar task completion must be explicit');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const row=await client.query(
      'UPDATE enkyron_calendar_tasks SET completed_at=NOW() '+
      'WHERE workspace_key=$1 AND task_id=$2 AND completed_at IS NULL RETURNING task_id',
      [key,id]
    );
    if(row.rowCount!==1)throw Error('Calendar task missing or already complete');
    await client.query(
      'INSERT INTO enkyron_mail_local_events '+
      '(id,workspace_key,event_kind,actor_local,detail) '+
      "VALUES($1,$2,'task_completed',$3,$4::jsonb)",
      [randomUUID(),key,actor,JSON.stringify({task_id:id})]
    );
    await client.query('COMMIT');
    return {id,completed:true};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}


// ENK-06 / M07 / UAT-06: scoped task editing without implicit completion.
function taskSnapshot(row){
  return {
    title:row.title,
    due_at:row.due_at==null?null:iso(
      row.due_at instanceof Date?row.due_at.toISOString():row.due_at),
    notes:row.notes,
    completed_at:row.completed_at==null?null:iso(
      row.completed_at instanceof Date
        ?row.completed_at.toISOString():row.completed_at)
  };
}

function inputTaskSnapshot(data){
  if(!data || !['title','due_at','notes','completed_at']
      .every(k=>Object.hasOwn(data,k)))
    throw Error('Invalid calendar task expected values');
  if(typeof data.title!=='string'||data.title.length<1||
     data.title.length>200||typeof data.notes!=='string'||
     data.notes.length>4000||data.notes.includes('\u0000'))
    throw Error('Invalid calendar task expected values');
  return {
    title:data.title,
    due_at:data.due_at==null?null:iso(data.due_at),
    notes:data.notes,
    completed_at:data.completed_at==null?null:iso(data.completed_at)
  };
}

export async function calendarReadTask(pool,actor,input){
  const key=scope(actor),id=input?.id;
  if(typeof id!=='string'||!UUID.test(id))
    throw Error('Invalid calendar task ID');
  const result=await pool.query(
    'SELECT task_id AS id,title,due_at,completed_at,crm_company_id,notes '+
    'FROM enkyron_calendar_tasks WHERE workspace_key=$1 AND task_id=$2',
    [key,id]
  );
  if(result.rows.length!==1)
    throw Error('Calendar task not found or not accessible');
  return {task:result.rows[0]};
}

export async function calendarUpdateTask(pool,actor,input){
  const key=scope(actor),id=input?.id;
  if(typeof id!=='string'||!UUID.test(id))
    throw Error('Invalid calendar task ID');
  if(!input || !Object.hasOwn(input,'due_at') ||
     !Object.hasOwn(input,'notes'))
    throw Error('Invalid calendar task update');

  const title=textValue(input.title,200);
  const due=input.due_at==null?null:iso(input.due_at);
  const notes=input.notes;
  if(typeof notes!=='string'||notes.length>4000||
     notes.includes('\u0000'))
    throw Error('Invalid calendar task notes');

  const expected=inputTaskSnapshot(input.expected);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const found=await client.query(
      'SELECT title,due_at,notes,completed_at FROM enkyron_calendar_tasks '+
      'WHERE workspace_key=$1 AND task_id=$2 FOR UPDATE',
      [key,id]
    );
    if(found.rows.length!==1)
      throw Error('Calendar task not found or not accessible');

    const previous=taskSnapshot(found.rows[0]);
    if(JSON.stringify(previous)!==JSON.stringify(expected))
      throw Error(
        'Calendar task changed since it was opened. Refresh before editing'
      );

    const next={...previous,title,due_at:due,notes};
    if(JSON.stringify(next)===JSON.stringify(previous)){
      await client.query('COMMIT');
      return {id,unchanged:true};
    }

    const changed=['title','due_at','notes']
      .filter(k=>previous[k]!==next[k]);
    const updated=await client.query(
      'UPDATE enkyron_calendar_tasks SET title=$3,due_at=$4,notes=$5 '+
      'WHERE workspace_key=$1 AND task_id=$2 RETURNING task_id',
      [key,id,title,due,notes]
    );
    if(updated.rowCount!==1)
      throw Error('Calendar task changed before save');

    const digest=record=>createHash('sha256')
      .update(JSON.stringify(record)).digest('hex');

    await client.query(
      'INSERT INTO enkyron_mail_local_events '+
      '(id,workspace_key,event_kind,actor_local,detail) '+
      "VALUES($1,$2,'calendar_updated',$3,$4::jsonb)",
      [randomUUID(),key,actor,JSON.stringify({
        entity:'task',
        task_id:id,
        changed_fields:changed,
        before_sha256:digest(previous),
        after_sha256:digest(next)
      })]
    );
    await client.query('COMMIT');
    return {id,updated:true};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}
