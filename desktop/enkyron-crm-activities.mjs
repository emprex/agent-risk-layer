// ENKYRON CRM manual activity history; operator testimony, never email transport proof.
// OS-user scope is only for the local single-operator workflow, not remote RBAC.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
export const ACTIVITY_TYPES=Object.freeze([
  'note','call_note','meeting_note','email_note','task_note'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
export function requireOpportunityId(id){
  if(typeof id!=='string'||!UUID.test(id))
    throw new Error('CRM invalid opportunity identifier');
  return id;
}
export function validateActivity(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid activity record');
  const company_id=input.company_id==null?null:requireCompanyId(input.company_id);
  const opportunity_id=input.opportunity_id==null?null:requireOpportunityId(input.opportunity_id);
  if((company_id===null)===(opportunity_id===null))
    throw new Error('CRM activity requires exactly one company or opportunity');
  if(!ACTIVITY_TYPES.includes(input.activity_type))
    throw new Error('CRM invalid manual activity type');
  const detail=input.detail;
  if(typeof detail!=='string'||detail.trim().length<10||detail.trim().length>2000
    ||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(detail))
    throw new Error('CRM manual activity detail must have 10–2000 characters');
  if(input.reviewed!==true)
    throw new Error('CRM operator confirmation required');
  return {opportunity_id,company_id,activity_type:input.activity_type,detail:detail.trim()};
}
export async function listActivityTimeline(pool,id,actor){
  const opportunityId=requireOpportunityId(id),owner=scope(actor);
  try{
    const row=(await pool.query(
      'SELECT id,prospect_id,company_id,company_name_at_creation,stage,next_action,due_date,probability_percent,owner_local,version '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND id=$2',
      [owner.key,opportunityId]
    )).rows[0];
    if(!row)throw new Error('CRM opportunity not found in local workspace');
    const history=await pool.query(
      'SELECT id,entry_kind,event_type,old_stage,new_stage,old_next_action, '
      +'new_next_action,old_due_date,new_due_date,activity_type,detail, '
      +'actor_local,recorded_at FROM ( '
      +"SELECT id,'change'::text AS entry_kind,event_type,old_stage,new_stage, "
      +'old_next_action,new_next_action,old_due_date,new_due_date, '
      +'NULL::text AS activity_type,NULL::text AS detail, '
      +'actor_local,created_at AS recorded_at '
      +'FROM enkyron_crm_opportunity_events WHERE workspace_key=$1 AND opportunity_id=$2 '
      +'UNION ALL '
      +"SELECT id,'activity'::text AS entry_kind,'recorded'::text AS event_type, "
      +'NULL::text,NULL::text,NULL::text,NULL::text,NULL::date,NULL::date, '
      +'activity_type,detail,recorded_by AS actor_local,recorded_at '
      +'FROM enkyron_crm_activities WHERE workspace_key=$1 AND opportunity_id=$2 '
      +') entries ORDER BY recorded_at DESC,id DESC LIMIT 101',
      [owner.key,opportunityId]
    );
    // Keep the newest 100 records but present them oldest-to-newest.
    return {available:true,opportunity:row,items:history.rows.slice(0,100).reverse(),
      more:history.rows.length>100,
      notice:'Operator-recorded notes and stage changes, not verified email delivery.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],more:false,
      notice:'CRM activity schema 069 has not been installed locally.'};
    throw e;
  }
}
export async function recordActivity(pool,input,actor,options={}){
  const activity=validateActivity(input),owner=scope(actor);
  const uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const companyMode=activity.company_id!==null;
    const source=companyMode?'enkyron_crm_companies':'enkyron_crm_opportunities';
    const parentId=companyMode?activity.company_id:activity.opportunity_id;
    const result=await client.query(
      'SELECT id FROM '+source+' WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.key,parentId]
    );
    if(!result.rows[0])throw new Error(
      'CRM '+(companyMode?'company':'opportunity')+' not found in local workspace'
    );
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_activities '
      +'(id,workspace_key,opportunity_id,company_id,activity_type,detail,recorded_by) '
      +'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id,owner.key,activity.opportunity_id,activity.company_id,
        activity.activity_type,activity.detail,owner.name]
    );
    await client.query('COMMIT');
    return {id,opportunity_id:activity.opportunity_id,company_id:activity.company_id,
      activity_type:activity.activity_type,
      notice:'Manual note recorded; no external communication performed.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
