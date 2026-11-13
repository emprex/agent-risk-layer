// ENK-04: advisory, read-only handoff check from an exact CRM company opportunity.
// Does NOT grant authority to create, issue, send, sign, or accept a proposal.
// Company/actor relationships are checked by immutable IDs in one SQL snapshot.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const INTERNAL_DRAFT_STAGES=Object.freeze([
  'qualified','contact_planned','contacted','discovery','proposal','negotiation'
]);
function requireId(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid '+label+' identifier');
  return value;
}
export function validateCompanyProposalReadinessRequest(value){
  if(typeof value!=='string'||!/^([0-9a-f-]+):([0-9a-f-]+)$/.test(value))
    throw new Error('CRM invalid company proposal readiness request');
  const [company_id,opportunity_id]=value.split(':');
  return {
    company_id:requireId(company_id,'company'),
    opportunity_id:requireId(opportunity_id,'opportunity')
  };
}
function ownerKey(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
}
export function assessCompanyProposalReadiness({opportunity,qualification,draft_count}){
  if(!Number.isSafeInteger(draft_count)||draft_count<0)
    throw new Error('CRM invalid proposal draft count');
  const reasons=[];
  if(!opportunity)reasons.push('Selected opportunity is not directly linked to this company in the local workspace.');
  else if(!INTERNAL_DRAFT_STAGES.includes(opportunity.stage))
    reasons.push('Opportunity must be in a qualified, active commercial stage.');
  if(!qualification)reasons.push('Company-level human commercial qualification has not been recorded.');
  else if(qualification.fit_status!=='potential_fit')
    reasons.push('Latest company-level review does not indicate potential fit.');
  if(draft_count>0)
    reasons.push('A proposal draft already exists; review it instead of creating a duplicate.');
  return {
    eligible_for_internal_draft_review: reasons.length===0,
    blockers:reasons,
    external_issue_authorised:false,
    notice:'Advisory preparation check only. No verified buyer, price, consent, signed agreement, or test authorisation is inferred.'
  };
}
export async function getCompanyProposalReadiness(pool,arg,actor){
  const ids=validateCompanyProposalReadinessRequest(arg);
  const key=ownerKey(actor);
  const client=await pool.connect();
  let inTx=false;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTx=true;
    const company=(await client.query(
      'SELECT id,name FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
      [key,ids.company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    const opportunity=(await client.query(
      'SELECT id,company_id,stage,version,next_action,due_date '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND id=$2 '
      +'AND company_id=$3 AND source_ticket_id IS NULL',
      [key,ids.opportunity_id,ids.company_id]
    )).rows[0]??null;
    const qualification=(await client.query(
      'SELECT id,fit_status,priority,recorded_by,recorded_at '
      +'FROM enkyron_crm_qualification_reviews '
      +'WHERE workspace_key=$1 AND company_id=$2 AND contact_id IS NULL '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [key,ids.company_id]
    )).rows[0]??null;
    const drafts=(await client.query(
      'SELECT count(*)::integer AS draft_count FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND opportunity_id=$2',
      [key,ids.opportunity_id]
    )).rows[0];
    const count=drafts?.draft_count;
    const decision=assessCompanyProposalReadiness({
      opportunity,qualification,draft_count:count
    });
    await client.query('COMMIT');
    inTx=false;
    return {
      available:true,company_id:company.id,company_name:company.name,
      opportunity_id:ids.opportunity_id,
      opportunity:opportunity?{
        id:opportunity.id,stage:opportunity.stage,version:opportunity.version,
        next_action:opportunity.next_action,due_date:opportunity.due_date
      }:null,
      qualification:qualification?{
        id:qualification.id,fit_status:qualification.fit_status,
        priority:qualification.priority,recorded_by:qualification.recorded_by,
        recorded_at:qualification.recorded_at
      }:null,
      existing_draft_count:count,...decision
    };
  }catch(error){
    if(inTx)await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'CRM proposal preparation tables are not installed in this local workspace.'};
    throw error;
  }finally{client.release();}
}
