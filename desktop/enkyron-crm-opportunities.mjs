// ENKYRON: operator-led commercial follow-ups; no automatic outreach.
// Local OS identity partitions data but is NOT authenticated multi-tenant RBAC.
import {randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';
import {requireProspectId} from './enkyron-crm-link.mjs';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
import {requireTicketId} from './enkyron-contract.mjs';

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
  if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value)
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
export function validateOpportunityProbability(value){
  if(value===null)return null;
  if(!Number.isSafeInteger(value)||value<0||value>100)
    throw new Error('CRM win probability must be an integer 0–100 or unknown');
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
export function validateCompanyOpportunityCreate(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).some(k=>![
      'company_id','ticket_id','company_name_at_review',
      'ticket_number_at_review','next_action','due_date','confirmed'
    ].includes(k)))throw new Error('CRM invalid company opportunity request');
  if(data.confirmed!==true)throw new Error('CRM reviewed ticket confirmation required');
  return {
    company_id:requireCompanyId(data.company_id),
    ticket_id:requireTicketId(data.ticket_id),
    company_name_at_review:textField(data.company_name_at_review,'company name',1,300),
    ticket_number_at_review:textField(data.ticket_number_at_review,'ticket number',8,40),
    next_action:textField(data.next_action,'next action',5,1000),
    due_date:dateField(data.due_date)
  };
}
/** A manual CRM-only lead is not a service request or authorisation to test. */
export function validateDirectCompanyOpportunityCreate(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).some(k=>!['company_id','company_name_at_review',
      'next_action','due_date','confirmed'].includes(k)))
    throw new Error('CRM invalid direct company opportunity request');
  if(data.confirmed!==true)
    throw new Error('CRM manual company opportunity review required');
  return {
    company_id:requireCompanyId(data.company_id),
    company_name_at_review:textField(data.company_name_at_review,'company name',1,300),
    next_action:textField(data.next_action,'next action',5,1000),
    due_date:dateField(data.due_date)
  };
}

export function validateOriginCorrection(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).some(k=>!['company_id','opportunity_id','ticket_id',
       'ticket_number_at_review','company_name_at_review','reason','confirmed'].includes(k)))
    throw new Error('CRM invalid commercial origin correction');
  if(data.confirmed!==true)
    throw new Error('CRM correction requires explicit human confirmation');
  if(typeof data.opportunity_id!=='string'||
     !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(data.opportunity_id))
    throw new Error('CRM invalid opportunity identifier');
  return {
    company_id:requireCompanyId(data.company_id),
    opportunity_id:data.opportunity_id,
    ticket_id:requireTicketId(data.ticket_id),
    ticket_number_at_review:textField(data.ticket_number_at_review,'ticket number',8,40),
    company_name_at_review:textField(data.company_name_at_review,'company name',1,300),
    reason:textField(data.reason,'correction reason',30,1000)
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
    due_date:dateField(data.due_date),
    ...(Object.hasOwn(data,'probability_percent')?
      {probability_percent:validateOpportunityProbability(data.probability_percent)}:{})
  };
}
export async function listOpportunities(pool,search,operator){
  const q=boundedSearch(search),scope=workspace(operator);
  try{
    const result=await pool.query(
      'SELECT o.id,o.prospect_id,o.company_id,o.source_ticket_id,'
      +'o.company_name_at_creation,o.stage,o.next_action,'
      +'o.due_date,o.probability_percent,o.version,o.updated_at,'
      +'COALESCE(p.company_name,c.name) AS current_candidate_name,'
      +"CASE WHEN o.company_id IS NOT NULL AND o.source_ticket_id IS NULL THEN 'crm_company_direct' WHEN o.company_id IS NOT NULL THEN 'reviewed_company_ticket' "
      +"ELSE p.source END AS prospect_source "
      +'FROM enkyron_crm_opportunities o '
      +'LEFT JOIN sales_prospects p ON p.id=o.prospect_id '
      +'LEFT JOIN enkyron_crm_companies c ON c.id=o.company_id '
      +'AND c.workspace_key=o.workspace_key '
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
      'SELECT id,prospect_id,stage,next_action,due_date,probability_percent,version '
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
      'SELECT id,stage,next_action,due_date,probability_percent,version FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [scope.key,req.id]
    )).rows[0];
    if(!existing)throw new Error('CRM opportunity not found for local operator');
    if(existing.version!==req.expected_version)
      throw new Error('CRM opportunity changed since opening; refresh before saving');
    const oldDue=existing.due_date
      ? (existing.due_date instanceof Date ? existing.due_date.toISOString().slice(0,10)
        : String(existing.due_date).slice(0,10)) : null;
    const oldProbability=existing.probability_percent??null;
    const nextProbability=Object.hasOwn(req,'probability_percent')?
      req.probability_percent:oldProbability;
    if(existing.stage===req.stage&&existing.next_action===req.next_action&&
       oldDue===req.due_date&&oldProbability===nextProbability)
      throw new Error('CRM no changes to record');
    const updated=(await client.query(
      'UPDATE enkyron_crm_opportunities '
      +'SET stage=$3,next_action=$4,due_date=$5,probability_percent=$7,'
      +'version=version+1,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND version=$6 '
      +'RETURNING id,version',
      [scope.key,req.id,req.stage,req.next_action,req.due_date,
       req.expected_version,nextProbability]
    )).rows[0];
    if(!updated)throw new Error('CRM opportunity revision conflict');
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,old_stage,new_stage,'
      +'old_next_action,new_next_action,old_due_date,new_due_date,actor_local,'
      +'old_probability_percent,new_probability_percent) '
      +"VALUES($1,$2,$3,'updated',$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [uuid(),scope.key,req.id,existing.stage,req.stage,
        existing.next_action,req.next_action,oldDue,req.due_date,scope.actor,
        oldProbability,nextProbability]
    );
    return {id:req.id,version:updated.version,stage:req.stage};
  });
}

/**
 * The new company-first route is separate from legacy research prospects.
 * No sales_prospects write, no ticket rewrite and no inferred name association.
 * The operator explicitly reviews the already effective CRM ticket link.
 */
export async function createCompanyOpportunity(pool,input,operator,options={}){
  const req=validateCompanyOpportunityCreate(input),scope=workspace(operator);
  const uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const company=(await client.query(
      'SELECT id,name FROM enkyron_crm_companies '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [scope.key,req.company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    if(company.name!==req.company_name_at_review)
      throw new Error('CRM company identity changed; reopen before creating an opportunity');
    const ticket=(await client.query(
      'SELECT id,ticket_number,status,archived_at '
      +'FROM arl_workbench_tickets WHERE id=$1 FOR KEY SHARE',
      [req.ticket_id]
    )).rows[0];
    if(!ticket||ticket.ticket_number!==req.ticket_number_at_review)
      throw new Error('CRM source ticket changed or not found');
    if(ticket.archived_at||ticket.status==='closed')
      throw new Error('CRM closed or archived source ticket cannot start an opportunity');
    const reviewed=(await client.query(
      'SELECT 1 FROM enkyron_crm_effective_ticket_links '
      +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
      [scope.key,req.company_id,req.ticket_id]
    )).rows[0];
    if(!reviewed)throw new Error('CRM company-ticket association not currently reviewed');
    const corrected=(await client.query(
      'SELECT 1 FROM enkyron_crm_opportunity_origin_corrections '
      +'WHERE workspace_key=$1 AND old_source_ticket_id=$2',
      [scope.key,req.ticket_id]
    )).rows[0];
    if(corrected)
      throw new Error('CRM corrected commercial ticket cannot originate a new opportunity');
    const existing=(await client.query(
      'SELECT id FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND company_id=$2 AND source_ticket_id=$3',
      [scope.key,req.company_id,req.ticket_id]
    )).rows[0];
    if(existing)throw new Error('CRM opportunity already exists for this company-ticket pair');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_opportunities '
      +'(id,workspace_key,prospect_id,company_id,source_ticket_id,'
      +'company_name_at_creation,stage,next_action,due_date,owner_local) '
      +"VALUES($1,$2,NULL,$3,$4,$5,'research',$6,$7,$8)",
      [id,scope.key,req.company_id,req.ticket_id,company.name,
       req.next_action,req.due_date,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,new_stage,new_next_action,'
      +"new_due_date,actor_local) VALUES($1,$2,$3,'created','research',$4,$5,$6)",
      [uuid(),scope.key,id,req.next_action,req.due_date,scope.actor]
    );
    return {id,prospect_id:null,company_id:req.company_id,
      source_ticket_id:req.ticket_id,stage:'research',version:1,
      notice:'Internal commercial opportunity only; no client acceptance, test or outreach.'};
  });
}

/** Company-first prospecting: no prospect import, ticket, service action or outreach. */
export async function createDirectCompanyOpportunity(pool,input,operator,options={}){
  const req=validateDirectCompanyOpportunityCreate(input),scope=workspace(operator);
  const uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    // Serialise direct opportunities per company, including against parallel operators.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [scope.key+':company-opportunity:'+req.company_id]);
    const company=(await client.query(
      'SELECT id,name FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [scope.key,req.company_id]
    )).rows[0];
    if(!company||company.name!==req.company_name_at_review)
      throw new Error('CRM company changed; review again');
    const existing=(await client.query(
      'SELECT id FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND company_id=$2 AND source_ticket_id IS NULL',
      [scope.key,req.company_id]
    )).rows;
    if(existing.length)
      throw new Error('CRM direct company opportunity already exists; open it instead');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_opportunities (id,workspace_key,prospect_id,company_id,source_ticket_id,'
      +'company_name_at_creation,stage,next_action,due_date,owner_local) '
      +"VALUES($1,$2,NULL,$3,NULL,$4,'research',$5,$6,$7)",
      [id,scope.key,company.id,company.name,req.next_action,req.due_date,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,new_stage,new_next_action,new_due_date,actor_local) '
      +"VALUES($1,$2,$3,'created','research',$4,$5,$6)",
      [uuid(),scope.key,id,req.next_action,req.due_date,scope.actor]
    );
    return {id,company_id:company.id,source_ticket_id:null,stage:'research',version:1,
      notice:'CRM opportunity only. No client ticket, contact, outbound message or assessment created.'};
  });
}

/** Reviewed correction: de-link a synthetic commercial intake from its opportunity.
 * Source ticket stays available with its original immutable history.
 */
export async function correctCommercialOrigin(pool,input,operator,options={}){
  const req=validateOriginCorrection(input),scope=workspace(operator);
  const uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const opportunity=(await client.query(
      'SELECT id,company_id,prospect_id,source_ticket_id,stage,next_action,due_date,version '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [scope.key,req.opportunity_id]
    )).rows[0];
    if(!opportunity||opportunity.company_id!==req.company_id||
       opportunity.prospect_id!==null||
       opportunity.source_ticket_id!==req.ticket_id)
      throw new Error('CRM correction source changed; stop without modification');
    const company=(await client.query(
      'SELECT name FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
      [scope.key,req.company_id]
    )).rows[0];
    if(!company||company.name!==req.company_name_at_review)
      throw new Error('CRM company identity does not match');
    const ticket=(await client.query(
      'SELECT ticket_number,title,client_name,target_reference,linked_project_id,linked_assessment_id '
      +'FROM arl_workbench_tickets WHERE id=$1 FOR KEY SHARE',
      [req.ticket_id]
    )).rows[0];
    if(!ticket||ticket.ticket_number!==req.ticket_number_at_review||
       ticket.client_name!==company.name||
       ticket.target_reference!=='intake:manual'||
       !(
         ticket.title==='Partnership enquiry - Threat ResQ - LinkedIn - 2026-11-09'||
         ticket.title==='Internal commercial lead - Xurrent - LinkedIn - 2026-11-09'
       )||
       ticket.linked_project_id||ticket.linked_assessment_id)
      throw new Error('CRM correction is limited to the two reviewed synthetic LinkedIn tickets');
    // The original CRM ticket association must still be active and exclusively
    // linked to this company. The correction revokes it in the same transaction.
    const sourceLink=(await client.query(
      'SELECT id FROM enkyron_crm_ticket_links '
      +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3 FOR UPDATE',
      [scope.key,req.company_id,req.ticket_id]
    )).rows[0];
    const revoked=(await client.query(
      'SELECT id FROM enkyron_crm_ticket_link_revocations '
      +'WHERE workspace_key=$1 AND ticket_id=$2',
      [scope.key,req.ticket_id]
    )).rows[0];
    if(!sourceLink||revoked)
      throw new Error('CRM source link absent or already revoked; manual review required');
    const references=(await client.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND source_ticket_id=$2',
      [scope.key,req.ticket_id]
    )).rows[0].n;
    if(references!==1)
      throw new Error('CRM ticket is referenced by other opportunities; stop');
    await client.query(
      'UPDATE enkyron_crm_opportunities '
      +'SET source_ticket_id=NULL,version=version+1,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2',
      [scope.key,req.opportunity_id]
    );
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_origin_corrections '
      +'(id,workspace_key,opportunity_id,old_source_ticket_id,company_id,reason,actor_local) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uuid(),scope.key,req.opportunity_id,req.ticket_id,
        req.company_id,req.reason,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,old_stage,new_stage,'
      +'old_next_action,new_next_action,old_due_date,new_due_date,actor_local) '
      +"VALUES($1,$2,$3,'updated',$4,$4,$5,$5,$6,$6,$7)",
      [uuid(),scope.key,req.opportunity_id,opportunity.stage,
        opportunity.next_action,opportunity.due_date,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_ticket_link_revocations '
      +'(id,workspace_key,link_id,company_id,ticket_id,ticket_client_name_at_review,review_note,revoked_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [uuid(),scope.key,sourceLink.id,req.company_id,req.ticket_id,
        company.name,req.reason,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_events '
      +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
      +"VALUES($1,$2,'company',$3,'corrected',$4)",
      [uuid(),scope.key,req.company_id,scope.actor]
    );
    return {id:req.opportunity_id,company_id:req.company_id,source_ticket_id:null,
      version:opportunity.version+1,
      notice:'Commercial-only opportunity corrected; mistaken ticket association revoked. Original ticket retained, no service status invented.'};
  });
}
