// ENKYRON Calendar: operator-owned local appointments and tasks.
// No external calendar invitations, auto-send, or invented assignees.
import {randomUUID} from 'node:crypto';
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
      'SELECT task_id AS id,title,due_at,completed_at,crm_company_id '+
      'FROM enkyron_calendar_tasks WHERE workspace_key=$1 '+
      'AND (due_at IS NULL OR (due_at>=$2 AND due_at<$3)) '+
      'ORDER BY due_at ASC NULLS LAST LIMIT 300',
      [key,start,end]
    )
  ]);
  return {events:events.rows,tasks:tasks.rows};
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
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO enkyron_calendar_tasks(workspace_key,task_id,title,due_at) '+
      'VALUES($1,$2,$3,$4)',[key,id,title,due]
    );
    await client.query(
      'INSERT INTO enkyron_mail_local_events '+
      '(id,workspace_key,event_kind,actor_local,detail) '+
      "VALUES($1,$2,'task_created',$3,$4::jsonb)",
      [randomUUID(),key,actor,JSON.stringify({task_id:id})]
    );
    await client.query('COMMIT');
    return {id,title,due_at:due};
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
