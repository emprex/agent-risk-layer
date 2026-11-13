// ENK-04: one operator-priced, UNSENT company opportunity proposal draft.
// This route is deliberately separate from the existing legacy proposal editor.
// Recheck all advisory conditions *inside the write transaction*; never trust
// a previous read-only preparedness result as permission to create a draft.
import {createHash,randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
import {requireOpportunityId} from './enkyron-crm-activities.mjs';
import {validateProposalCreate} from './enkyron-crm-proposals.mjs';
import {assessCompanyProposalReadiness} from './enkyron-crm-proposal-readiness.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
export function validateCompanyProposalDraftCreate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     input.confirmed!==true)
    throw new Error('CRM company proposal requires explicit human confirmation');
  const company_id=requireCompanyId(input.company_id);
  const qualification_id=input.qualification_id;
  if(typeof qualification_id!=='string'||!UUID.test(qualification_id))
    throw new Error('CRM invalid latest company qualification ID');
  if(!Number.isSafeInteger(input.expected_opportunity_version)||
      input.expected_opportunity_version<1)
    throw new Error('CRM invalid expected opportunity version');
  const proposal=validateProposalCreate(input);
  return {
    ...proposal,company_id,qualification_id,
    expected_opportunity_version:input.expected_opportunity_version
  };
}
function digest(data){
  return createHash('sha256').update(JSON.stringify([
    data.title,data.scope_text,data.currency,data.amount_minor
  ])).digest('hex');
}
export async function createCompanyProposalDraft(pool,input,actor,options={}){
  const data=validateCompanyProposalDraftCreate(input),who=owner(actor);
  const uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  let begun=false;
  try{
    await client.query('BEGIN');
    begun=true;
    // Serializes *this guarded route* on the exact company/opportunity.
    // Does not claim to serialize unrelated legacy proposal write routes.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [who.key+':company-proposal:'+data.company_id+':'+data.opportunity_id]);
    const company=(await client.query(
      'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 '
      +'AND id=$2 FOR KEY SHARE',[who.key,data.company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    const opportunity=(await client.query(
      'SELECT id,company_id,stage,version,next_action,due_date '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 '
      +'AND id=$2 AND company_id=$3 AND source_ticket_id IS NULL FOR SHARE',
      [who.key,data.opportunity_id,data.company_id]
    )).rows[0]??null;
    if(opportunity && opportunity.version!==data.expected_opportunity_version)
      throw new Error('CRM opportunity changed; refresh preparation before creating a draft');
    const qualification=(await client.query(
      'SELECT id,fit_status FROM enkyron_crm_qualification_reviews '
      +'WHERE workspace_key=$1 AND company_id=$2 AND contact_id IS NULL '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [who.key,data.company_id]
    )).rows[0]??null;
    if(!qualification||qualification.id!==data.qualification_id)
      throw new Error('CRM latest company qualification changed; refresh preparation');
    const drafts=(await client.query(
      'SELECT count(*)::integer AS n FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND opportunity_id=$2',
      [who.key,data.opportunity_id]
    )).rows[0];
    const result=assessCompanyProposalReadiness({
      opportunity,qualification,draft_count:drafts?.n
    });
    if(!result.eligible_for_internal_draft_review)
      throw new Error('CRM company proposal preparation blocked: '+result.blockers.join('; '));
    const id=uuid(),eventId=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_drafts '
      +'(id,workspace_key,opportunity_id,title,scope_text,currency,amount_minor,'
      +'created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [id,who.key,data.opportunity_id,data.title,data.scope_text,
       data.currency,data.amount_minor,who.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_proposal_draft_events '
      +'(id,workspace_key,proposal_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,1,'created',$4,$5)",
      [eventId,who.key,id,digest(data),who.actor]
    );
    await client.query('COMMIT');
    begun=false;
    return {
      id,revision:1,company_id:data.company_id,
      opportunity_id:data.opportunity_id,qualification_id:data.qualification_id,
      notice:'One internal proposal draft saved. No message, quote, contract or invoice was issued.'
    };
  }catch(error){
    if(begun)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
