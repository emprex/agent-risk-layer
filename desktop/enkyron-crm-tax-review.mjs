// ENKYRON international tax evidence: human research journal, not tax advice.
// Never computes VAT, reverse-charge claims, sales taxes or tax registration.
// No mutation of proposals, prices, customer classifications or email.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES=['unknown','business','consumer'];
const MODES=['unknown','human_led_advisory','automated_digital','mixed_or_other'];
const UK_STATUS=['unknown','registered','not_registered','application_pending'];
const WHT=['not_checked','potential_issue','reviewed_manually'];
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function id(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid proposal identifier');
  return value;
}
function notes(value,label,min,max,optional=false){
  if(optional&&(value===undefined||value===null||value===''))return null;
  if(typeof value!=='string'||value.length>max||
     /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error('CRM invalid '+label);
  const trimmed=value.trim();
  if(trimmed.length<min||trimmed.length>max)
    throw new Error('CRM invalid '+label);
  return trimmed;
}
export function validateTaxReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid tax review');
  const proposal_id=id(input.proposal_id);
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid proposal revision');
  if(!TYPES.includes(input.buyer_type)||
     !MODES.includes(input.service_mode)||
     !UK_STATUS.includes(input.uk_vat_registration)||
     !WHT.includes(input.overseas_withholding))
    throw new Error('CRM invalid review classification');
  if(input.confirmed!==true)
    throw new Error('CRM manual tax review confirmation required');
  const buyer_country=(input.buyer_country??'').trim().toUpperCase()||null;
  if(buyer_country!==null&&!/^[A-Z]{2}$/.test(buyer_country))
    throw new Error('CRM buyer country must be a 2-letter ISO code');
  const business_evidence=notes(input.business_evidence,'business evidence',10,1000,true);
  const location_evidence=notes(input.location_evidence,'location evidence',10,1000,true);
  const review_notes=notes(input.review_notes,'tax review notes',30,2000);
  const source_reference=notes(input.source_reference,'source reference',5,500,true);
  if(input.buyer_type==='business'&&!business_evidence)
    throw new Error('CRM B2B status requires independent business evidence');
  if(buyer_country&&!location_evidence)
    throw new Error('CRM buyer country requires source evidence');
  return {proposal_id,expected_revision:input.expected_revision,
    buyer_type:input.buyer_type,buyer_country,service_mode:input.service_mode,
    business_evidence,location_evidence,uk_vat_registration:input.uk_vat_registration,
    overseas_withholding:input.overseas_withholding,
    review_notes,source_reference};
}
export async function getTaxReviews(pool,proposalId,actor){
  const key=owner(actor).key,proposal_id=id(proposalId);
  try{
    // Check existence even with zero records: foreign workspaces must not leak.
    const proposal=(await pool.query(
      'SELECT id,revision FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2',[key,proposal_id]
    )).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const rows=(await pool.query(
      'SELECT id,proposal_revision,buyer_type,buyer_country,service_mode,'
      +'business_evidence,location_evidence,uk_vat_registration,'
      +'overseas_withholding,review_notes,source_reference,'
      +'recorded_by,recorded_at FROM enkyron_crm_proposal_tax_reviews '
      +'WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 21',
      [key,proposal_id]
    )).rows;
    return {available:true,proposal_id,proposal_revision:proposal.revision,
      items:rows.slice(0,20),more:rows.length>20,
      notice:'Manual tax research only. No tax treatment or legal buyer has been verified by ENKYRON.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],
      notice:'International tax review requires the next CRM schema update.'};
    throw e;
  }
}
export async function recordTaxReview(pool,input,actor,options={}){
  const data=validateTaxReview(input),who=owner(actor),
    uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const proposal=(await client.query(
      'SELECT revision FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2 FOR SHARE',
      [who.key,data.proposal_id]
    )).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; refresh its tax review before recording');
    const recordId=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_tax_reviews '
      +'(id,workspace_key,proposal_id,proposal_revision,buyer_type,buyer_country,'
      +'service_mode,business_evidence,location_evidence,uk_vat_registration,'
      +'overseas_withholding,review_notes,source_reference,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [recordId,who.key,data.proposal_id,data.expected_revision,
        data.buyer_type,data.buyer_country,data.service_mode,data.business_evidence,
        data.location_evidence,data.uk_vat_registration,data.overseas_withholding,
        data.review_notes,data.source_reference,who.name]
    );
    await client.query('COMMIT');
    return {id:recordId,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
      notice:'Tax research note recorded. No tax determination, invoice or customer status change.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
