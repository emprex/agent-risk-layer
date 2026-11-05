// ENKYRON: operator-led commercial follow-ups; no automatic outreach.
// Local OS identity partitions data but is NOT authenticated multi-tenant RBAC.
import {randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';
import {requireProspectId} from './enkyron-crm-link.mjs';

export const OPPORTUNITY_STAGES=Object.freeze([
  'research','qualified','contact_planned','contacted','discovery',
  'proposal','negotiation','won','lost'
]);
function workspace(name){
  if(typeof name!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(name))
    throw new Error('CRM invalid local operator');
  return {actor:name,key:'local:'+name};
}
function textField(value,label,min,max){
  if(typeof value!=='string'||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    ||value.trim().length<min||value.trim().length>max) {
    throw new Error('CRM invalid '+label);
  }
  return value.trim();
}
function dateField(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('CRM due date must be YYYY-MM-DD or empty');
  const date=new Date(value+'T00:00:00Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw new Error('CRM invalid calendar date');
  return value;
}
export function validateOpportunityCreate(data){
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('CRM invalid opportunity request');
  return {
    prospect_id:requireProspectId(data.prospect_id),
    company_name_at_review:textField(data.company_name_at_review,
      'reviewed prospect name',1,300),
    next_action:textField(data.next_action,'next action',5,1000),
    due_date:dateField(data.due_date)
  };
}
export function validateOpportunityUpdate(data){
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('CRM invalid opportunity update');
  if(typeof data.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.id))
    throw new Error('CRM invalid opportunity identifier');
  if(!Number.isSafeInteger(data.expected_version)||data.expected_version<1)
    throw new Error('CRM invalid opportunity revision');
  if(!OPPORTUNITY_STAGES.includes(data.stage))
    throw new Error('CRM invalid commercial stage');
  return {
    id:data.id,
    expected_version:data.expected_version,
    stage:data.stage,
    next_action:textField(data.next_action,'next action',5,1000),
    due_date:dateField(data.due_date)
  };
}
export async function listOpportunities(pool,search,operator){
  const q=boundedSearch(search),scope=workspace(operator);
  try{
    const result=await pool.query(
      'SELECT o.id,o.prospect_id,o.company_name_at_creation,o.stage,o.next_action,'
      +'o.due_date,o.version,o.updated_at,p.company_name AS current_candidate_name,'
      +'p.source AS prospect_source '
      +'FROM enkyron_crm_opportunities o '
      +'JOIN sales_prospects p ON p.id=o.prospect_id '
      +'WHERE o.workspace_key=$1 AND '
      +"($2='' OR POSITION(LOWER($2) IN LOWER(o.company_name_at_creation))>0 "
      +'OR POSITION(LOWER($2) IN LOWER(o.next_action))>0) '
      +'ORDER BY o.due_date ASC NULLS LAST,o.updated_at DESC,o.id LIMIT 101',
      [scope.key,q]
    );
    return {available:true,items:result.rows.slice(0,100),
      more:result.rows.length>100,
      notice:'Manual opportunity records; no automatic customer or consent verification.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],more:false,
      notice:'CRM follow-up migration 068 is not installed locally.'};
    throw error;
  }
}
export async function prospectOpportunity(pool,id,operator){
  const prospectId=requireProspectId(id),scope=workspace(operator);
  try{
    const rows=(await pool.query(
      'SELECT id,prospect_id,stage,next_action,due_date,version '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND prospect_id=$2',
      [scope.key,prospectId]
    )).rows;
    return {available:true,opportunity:rows[0]??null};
  }catch(error){
    if(error?.code==='42P01')return {available:false,opportunity:null,
      notice:'CRM follow-up migration 068 is not installed locally.'};
    throw error;
  }
}
async function transaction(pool,work){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
export async function createOpportunity(pool,input,operator,options={}){
  const req=validateOpportunityCreate(input),scope=workspace(operator);
  const uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const source=(await client.query(
      'SELECT id,company_name FROM sales_prospects WHERE id=$1 FOR SHARE',
      [req.prospect_id]
    )).rows[0];
    if(!source)throw new Error('CRM prospect not found');
    if(source.company_name!==req.company_name_at_review)
      throw new Error('CRM prospect name changed; reopen selected candidate');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_opportunities '
      +'(id,workspace_key,prospect_id,company_name_at_creation,stage,'
      +"next_action,due_date,owner_local) VALUES($1,$2,$3,$4,'research',$5,$6,$7)",
      [id,scope.key,source.id,source.company_name,req.next_action,req.due_date,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,new_stage,new_next_action,'
      +"new_due_date,actor_local) VALUES($1,$2,$3,'created','research',$4,$5,$6)",
      [uuid(),scope.key,id,req.next_action,req.due_date,scope.actor]
    );
    return {id,prospect_id:source.id,stage:'research',version:1};
  });
}
export async function updateOpportunity(pool,input,operator,options={}){
  const req=validateOpportunityUpdate(input),scope=workspace(operator);
  const uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const existing=(await client.query(
      'SELECT id,stage,next_action,due_date,version FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [scope.key,req.id]
    )).rows[0];
    if(!existing)throw new Error('CRM opportunity not found for local operator');
    if(existing.version!==req.expected_version)
      throw new Error('CRM opportunity changed since opening; refresh before saving');
    const oldDue=existing.due_date
      ? (existing.due_date instanceof Date ? existing.due_date.toISOString().slice(0,10)
        : String(existing.due_date).slice(0,10)) : null;
    if(existing.stage===req.stage&&existing.next_action===req.next_action&&oldDue===req.due_date)
      throw new Error('CRM no changes to record');
    const updated=(await client.query(
      'UPDATE enkyron_crm_opportunities '
      +'SET stage=$3,next_action=$4,due_date=$5,version=version+1,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND version=$6 '
      +'RETURNING id,version',
      [scope.key,req.id,req.stage,req.next_action,req.due_date,req.expected_version]
    )).rows[0];
    if(!updated)throw new Error('CRM opportunity revision conflict');
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,old_stage,new_stage,'
      +'old_next_action,new_next_action,old_due_date,new_due_date,actor_local) '
      +"VALUES($1,$2,$3,'updated',$4,$5,$6,$7,$8,$9,$10)",
      [uuid(),scope.key,req.id,existing.stage,req.stage,
        existing.next_action,req.next_action,oldDue,req.due_date,scope.actor]
    );
    return {id:req.id,version:updated.version,stage:req.stage};
  });
}
