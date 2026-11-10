// ENKYRON UX-13: company-owned dated follow-ups, independent of opportunities.
// Manual planning only: no email transport, customer consent or inferred response.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statuses=new Set(['open','completed','cancelled']);
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function actionText(value){
  if(typeof value!=='string'||value.trim().length<5||value.trim().length>1000
    ||/[\x00-\x1f\x7f]/.test(value))
    throw new Error('CRM follow-up action must have 5–1000 plain-text characters');
  return value.trim();
}
function dueDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('CRM follow-up date must be YYYY-MM-DD');
  const [year,month,day]=value.split('-').map(Number);
  const d=new Date(Date.UTC(year,month-1,day));
  if(year<2000||year>2099||!Number.isFinite(d.getTime())
    ||d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)
    throw new Error('CRM follow-up date is invalid');
  return value;
}
export function validateCompanyFollowupCreate(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid company follow-up');
  if(input.confirmed!==true)throw new Error('CRM follow-up operator confirmation required');
  return {company_id:requireCompanyId(input.company_id),
    action_text:actionText(input.action_text),due_date:dueDate(input.due_date)};
}
export function validateCompanyFollowupUpdate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||typeof input.id!=='string'||!UUID.test(input.id))
    throw new Error('CRM invalid company follow-up identifier');
  if(!Number.isSafeInteger(input.expected_version)||input.expected_version<1)
    throw new Error('CRM invalid follow-up version');
  if(!statuses.has(input.status))
    throw new Error('CRM invalid follow-up status');
  if(input.confirmed!==true)throw new Error('CRM follow-up operator confirmation required');
  return {id:input.id,expected_version:input.expected_version,
    action_text:actionText(input.action_text),due_date:dueDate(input.due_date),status:input.status};
}
async function transact(pool,fn){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const data=await fn(c);
    await c.query('COMMIT');
    return data;
  }catch(error){
    await c.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{c.release();}
}
export async function createCompanyFollowup(pool,input,actor,options={}){
  const data=validateCompanyFollowupCreate(input),owner=scope(actor);
  const uuid=options.uuid??randomUUID;
  return transact(pool,async c=>{
    const found=(await c.query(
      'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.key,data.company_id]
    )).rows[0];
    if(!found)throw new Error('CRM company not found in local workspace');
    const id=uuid();
    await c.query(
      'INSERT INTO enkyron_crm_company_followups '
      +'(id,workspace_key,company_id,action_text,due_date,created_by,updated_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$6)',
      [id,owner.key,data.company_id,data.action_text,data.due_date,owner.name]
    );
    await c.query(
      'INSERT INTO enkyron_crm_company_followup_events '
      +'(id,workspace_key,followup_id,version,event_type,new_action_text,new_due_date,new_status,actor_local) '
      +"VALUES($1,$2,$3,1,'created',$4,$5,'open',$6)",
      [uuid(),owner.key,id,data.action_text,data.due_date,owner.name]
    );
    return {id,company_id:data.company_id,version:1,status:'open',
      notice:'Company follow-up scheduled locally. No external communication performed.'};
  });
}
export async function updateCompanyFollowup(pool,input,actor,options={}){
  const data=validateCompanyFollowupUpdate(input),owner=scope(actor);
  const uuid=options.uuid??randomUUID;
  return transact(pool,async c=>{
    const prior=(await c.query(
      'SELECT id,company_id,action_text,due_date::text AS due_date,status,version '
      +'FROM enkyron_crm_company_followups '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [owner.key,data.id]
    )).rows[0];
    if(!prior)throw new Error('CRM company follow-up not found in local workspace');
    if(prior.version!==data.expected_version)
      throw new Error('CRM company follow-up changed; reload before editing');
    const previousDate=String(prior.due_date).slice(0,10);
    if(prior.status!=='open')
      throw new Error('CRM closed company follow-up cannot be edited; create a new one');
    if(prior.action_text===data.action_text&&previousDate===data.due_date
      &&prior.status===data.status)throw new Error('CRM follow-up has no changes to save');
    const version=data.expected_version+1;
    await c.query(
      'UPDATE enkyron_crm_company_followups '
      +'SET action_text=$3,due_date=$4,status=$5,version=$6,updated_by=$7,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND version=$8',
      [owner.key,data.id,data.action_text,data.due_date,data.status,version,
        owner.name,data.expected_version]
    );
    await c.query(
      'INSERT INTO enkyron_crm_company_followup_events '
      +'(id,workspace_key,followup_id,version,event_type,old_action_text,new_action_text,'
      +'old_due_date,new_due_date,old_status,new_status,actor_local) '
      +"VALUES($1,$2,$3,$4,'updated',$5,$6,$7,$8,$9,$10,$11)",
      [uuid(),owner.key,data.id,version,prior.action_text,data.action_text,
        previousDate,data.due_date,prior.status,data.status,owner.name]
    );
    return {id:data.id,company_id:prior.company_id,version,status:data.status,
      notice:'Company follow-up changed locally; revision preserved.'};
  });
}
export async function listCompanyFollowups(pool,companyId,actor){
  const id=requireCompanyId(companyId),owner=scope(actor);
  try{
    const exists=(await pool.query(
      'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
      [owner.key,id]
    )).rows[0];
    if(!exists)throw new Error('CRM company not found in local workspace');
    const data=await pool.query(
      'SELECT f.id,f.company_id,f.action_text,f.due_date::text AS due_date,f.status,f.version,'
      +'f.created_at,f.updated_at '
      +'FROM enkyron_crm_company_followups f '
      +'WHERE f.workspace_key=$1 AND f.company_id=$2 '
      +"ORDER BY CASE WHEN f.status='open' THEN 0 ELSE 1 END,"
      +'f.due_date,f.id LIMIT 101',[owner.key,id]
    );
    return {available:true,items:data.rows.slice(0,100),more:data.rows.length>100};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],more:false,
      notice:'ENKYRON company follow-up schema 105 not installed locally.'};
    throw e;
  }
}
export async function listUpcomingCompanyFollowups(pool,actor){
  const owner=scope(actor);
  try{
    const rows=await pool.query(
      'SELECT f.id,f.company_id,c.name AS company_name,f.action_text,f.due_date::text AS due_date,'
      +'f.status,f.version,f.updated_at '
      +'FROM enkyron_crm_company_followups f '
      +'JOIN enkyron_crm_companies c ON c.workspace_key=f.workspace_key AND c.id=f.company_id '
      +"WHERE f.workspace_key=$1 AND f.status='open' "
      +'ORDER BY f.due_date,f.id LIMIT 101',[owner.key]
    );
    return {available:true,items:rows.rows.slice(0,100),more:rows.rows.length>100};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],more:false,
      notice:'ENKYRON company follow-up schema 105 not installed locally.'};
    throw e;
  }
}
