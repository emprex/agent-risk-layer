// Operator-led company/contact commercial qualification: manual observations only.
// These entries never change a company's client status, contact verification,
// marketing permissions, tickets, or outgoing communications.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';

export const FIT_STATES=Object.freeze([
  'needs_research','potential_fit','not_fit','on_hold'
]);
export const PRIORITIES=Object.freeze(['low','normal','high']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function scope(actor){
  if(typeof actor!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function field(value,label,min,max){
  if(typeof value!=='string'||value.length>max||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error('CRM invalid '+label);
  const trimmed=value.trim();
  if(trimmed.length<min)throw new Error('CRM '+label+' requires at least '+min+' characters');
  return trimmed;
}
export function validateQualificationReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid qualification review');
  const company_id=requireCompanyId(input.company_id);
  const contact_id=input.contact_id==null||input.contact_id===''?
    null:input.contact_id;
  if(contact_id!==null&&(typeof contact_id!=='string'||!UUID.test(contact_id)))
    throw new Error('CRM invalid contact ID');
  if(!FIT_STATES.includes(input.fit_status))
    throw new Error('CRM invalid commercial fit status');
  if(!PRIORITIES.includes(input.priority))
    throw new Error('CRM invalid commercial priority');
  if(input.confirmed!==true)
    throw new Error('CRM manual qualification confirmation required');
  const rationale=field(input.rationale,'qualification rationale',20,1500);
  const next_action=input.next_action==null||input.next_action===''?null:
    field(input.next_action,'next action',5,500);
  const source_reference=input.source_reference==null||input.source_reference===''?null:
    field(input.source_reference,'source reference',0,500);
  return {company_id,contact_id,fit_status:input.fit_status,priority:input.priority,
    rationale,next_action,source_reference};
}
export async function recordQualificationReview(pool,input,actor,options={}){
  const data=validateQualificationReview(input),owner=scope(actor),
    uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const company=(await client.query(
      'SELECT id FROM enkyron_crm_companies '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.key,data.company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    if(data.contact_id){
      const contact=(await client.query(
        'SELECT id FROM enkyron_crm_contacts '
        +'WHERE workspace_key=$1 AND company_id=$2 AND id=$3 FOR KEY SHARE',
        [owner.key,data.company_id,data.contact_id]
      )).rows[0];
      if(!contact)throw new Error('CRM contact does not belong to this company');
    }
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_qualification_reviews '
      +'(id,workspace_key,company_id,contact_id,fit_status,priority,'
      +'rationale,next_action,source_reference,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id,owner.key,data.company_id,data.contact_id,data.fit_status,data.priority,
        data.rationale,data.next_action,data.source_reference,owner.actor]
    );
    await client.query('COMMIT');
    return {id,company_id:data.company_id,contact_id:data.contact_id,
      fit_status:data.fit_status,priority:data.priority,
      notice:'Manual commercial review recorded; no customer or contact status changed.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
