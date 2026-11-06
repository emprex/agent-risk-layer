// ENKYRON manual COMMERCIAL TERMS for an existing proposal DRAFT.
// A term record is bound to one proposal revision, immutable, operator-entered.
// Never implies customer acceptance, contract, tax decision, sending or assessment.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function proposalId(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid proposal identifier');
  return value;
}
function textField(value,label,min,max){
  if(typeof value!=='string'||value.length>max||CONTROL.test(value))
    throw new Error('CRM invalid commercial '+label);
  const trimmed=value.trim();
  if(trimmed.length<min||trimmed.length>max)
    throw new Error('CRM commercial '+label+' requires '+min+'–'+max+' characters');
  return trimmed;
}
export function validateCommercialTerms(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid commercial terms request');
  if(input.confirmed!==true)
    throw new Error('CRM commercial terms require explicit operator confirmation');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid commercial proposal revision');
  const validUntil=input.valid_until;
  if(typeof validUntil!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(validUntil))
    throw new Error('CRM commercial validity date must use YYYY-MM-DD');
  const day=new Date(validUntil+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==validUntil)
    throw new Error('CRM commercial validity date is not a real calendar date');
  return {
    proposal_id:proposalId(input.proposal_id),
    expected_revision:input.expected_revision,
    valid_until:validUntil,
    payment_terms:textField(input.payment_terms,'payment terms',15,1000),
    delivery_terms:textField(input.delivery_terms,'delivery terms',15,1000),
    exclusions:textField(input.exclusions,'exclusions',15,2000),
    assumptions:textField(input.assumptions,'assumptions',15,2000),
    source_reference:textField(input.source_reference,'source reference',3,500)
  };
}
export async function readCommercialTerms(pool,id,actor){
  const proposal=proposalId(id),scope=owner(actor);
  try{
    const row=(await pool.query(
      'SELECT id,revision,title FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2',[scope.key,proposal]
    )).rows[0];
    if(!row)throw new Error('CRM proposal not found in local workspace');
    const records=(await pool.query(
      'SELECT id,proposal_revision,valid_until::text AS valid_until,'
      +'payment_terms,delivery_terms,exclusions,assumptions,'
      +'source_reference,recorded_by,recorded_at,review_status '
      +'FROM enkyron_crm_proposal_commercial_terms '
      +'WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY proposal_revision DESC LIMIT 21',[scope.key,proposal]
    )).rows;
    return {
      available:true,proposal_id:proposal,proposal_revision:row.revision,
      proposal_title:row.title,
      current:records.find(r=>r.proposal_revision===row.revision)??null,
      history:records.slice(0,20).map(({proposal_revision,valid_until,
        recorded_by,recorded_at,source_reference,review_status})=>({
          proposal_revision,valid_until,recorded_by,recorded_at,
          source_reference,review_status
        })),
      more:records.length>20,
      notice:'Manual working terms for a draft revision only. '
        +'Not an approved or issued offer; no tax or contract decision.'
    };
  }catch(error){
    if(error?.code==='42P01')
      return {available:false,notice:'Commercial terms migration 079 is not installed.'};
    throw error;
  }
}
export async function recordCommercialTerms(pool,input,actor,options={}){
  const data=validateCommercialTerms(input),scope=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query(
      'SELECT revision FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',[scope.key,data.proposal_id]
    )).rows[0];
    if(!row)throw new Error('CRM proposal not found in local workspace');
    if(row.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; reopen current commercial terms');
    const existing=(await client.query(
      'SELECT id FROM enkyron_crm_proposal_commercial_terms '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3',
      [scope.key,data.proposal_id,data.expected_revision]
    )).rows[0];
    if(existing)throw new Error('CRM commercial terms already recorded for this revision');
    const id=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_commercial_terms '
      +'(id,workspace_key,proposal_id,proposal_revision,valid_until,'
      +'payment_terms,delivery_terms,exclusions,assumptions,source_reference,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id,scope.key,data.proposal_id,data.expected_revision,data.valid_until,
       data.payment_terms,data.delivery_terms,data.exclusions,data.assumptions,
       data.source_reference,scope.actor]
    );
    await client.query('COMMIT');
    return {id,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
      review_status:'operator_draft_unapproved',
      notice:'Draft commercial terms recorded. No quote issued, contract or assessment started.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
