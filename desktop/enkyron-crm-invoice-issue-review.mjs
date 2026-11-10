// ENKYRON human documentary checklist for an UNISSUED invoice draft.
// Evidence logging only; not tax/legal approval, not issue/send, no amount due.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const OUTCOMES=new Set(['needs_changes','documents_logged']);
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function id(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid invoice draft identifier');
  return value;
}
function field(value,name,min,max,optional=false){
  if(optional&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||value.length>max||CONTROL.test(value))
    throw new Error('CRM invalid invoice issue review '+name);
  const text=value.trim();
  if(text.length<min||text.length>max)
    throw new Error('CRM invoice issue review '+name+' must be '+min+'–'+max+' characters');
  return text;
}
function date(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('CRM invoice supply date must use YYYY-MM-DD');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
    throw new Error('CRM invalid real supply date');
  return value;
}
export function validateInvoiceIssueReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid invoice issue review request');
  if(input.confirmed!==true)
    throw new Error('CRM explicit human documentary confirmation required');
  if(!OUTCOMES.has(input.outcome))
    throw new Error('CRM unsupported invoice review outcome');
  const data={
    invoice_draft_id:id(input.invoice_draft_id),
    outcome:input.outcome,
    supply_date:date(input.supply_date),
    customer_authorisation_reference:field(input.customer_authorisation_reference,'customer authorisation',3,500,true),
    tax_evidence_reference:field(input.tax_evidence_reference,'tax evidence',3,500,true),
    payment_terms_reference:field(input.payment_terms_reference,'payment terms evidence',3,500,true),
    review_note:field(input.review_note,'review explanation',30,2000)
  };
  if(data.outcome==='documents_logged'&&(
    !data.supply_date||!data.customer_authorisation_reference||
    !data.tax_evidence_reference||!data.payment_terms_reference
  ))throw new Error('CRM documentation outcome requires all source references and supply date');
  return data;
}
const DRAFT='SELECT id,proposal_id,proposal_revision,source_worksheet_id,'
  +'issuer_profile_id,buyer_review_id,terms_id,tax_review_id,'
  +'issuer_legal_name,issuer_registered_office,buyer_legal_name,buyer_registered_address,'
  +'currency,proposed_fee_minor,service_description,status,invoice_number,issued_at,'
  +'vat_treatment FROM enkyron_crm_invoice_drafts WHERE workspace_key=$1 AND id=$2';
const ISSUER='SELECT id,vat_status,vat_number,company_email '
  +'FROM enkyron_operator_company_profiles WHERE workspace_key=$1 AND id=$2';
const REVIEWS='SELECT id,outcome,supply_date::text AS supply_date,'
  +'customer_authorisation_reference,tax_evidence_reference,payment_terms_reference,'
  +'review_note,recorded_by,recorded_at '
  +'FROM enkyron_crm_invoice_issue_reviews WHERE workspace_key=$1 '
  +'AND invoice_draft_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 21';

export async function readInvoiceIssueReview(pool,draftId,actor){
  const key=owner(actor).key,draft_id=id(draftId),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const draft=(await client.query(DRAFT,[key,draft_id])).rows[0];
    if(!draft)throw new Error('CRM invoice draft not found in local workspace');
    const issuer=(await client.query(ISSUER,[key,draft.issuer_profile_id])).rows[0]??null;
    const reviews=(await client.query(REVIEWS,[key,draft_id])).rows;
    await client.query('COMMIT');
    const blockers=[];
    if(draft.status!=='unissued_tax_review_required'||draft.invoice_number!==null||
       draft.issued_at!==null||draft.vat_treatment!=='undetermined')
      blockers.push('Invoice is not in the expected immutable unissued state');
    if(!issuer)blockers.push('Issuing company source profile is unavailable');
    if(issuer&&!issuer.company_email)
      blockers.push('Issuing company email is missing in its recorded profile');
    if(issuer?.vat_status==='unknown'||issuer?.vat_status==='application_pending')
      blockers.push('Issuing company VAT status is not established');
    if(issuer?.vat_status==='registered'&&!issuer.vat_number)
      blockers.push('Issuing company VAT number not recorded');
    const latest=reviews[0]??null;
    // These are evidence-intake gaps, not a determination of legal validity.
    // Even complete operator-supplied references NEVER grant issue authority.
    const documentary_gaps=[];
    if(!latest)documentary_gaps.push('No human documentary review recorded');
    else if(latest.outcome==='needs_changes')
      documentary_gaps.push('Latest human review requires changes');
    if(!latest?.supply_date)
      documentary_gaps.push('No evidenced service supply date recorded');
    if(!latest?.customer_authorisation_reference)
      documentary_gaps.push('No customer authorisation source recorded');
    if(!latest?.tax_evidence_reference)
      documentary_gaps.push('No tax evidence source recorded');
    if(!latest?.payment_terms_reference)
      documentary_gaps.push('No payment terms source recorded');
    return {
      available:true,invoice_draft_id:draft_id,draft,
      issuer_vat_status:issuer?.vat_status??'unavailable',
      issuer_has_vat_number:Boolean(issuer?.vat_number),
      issuer_has_company_email:Boolean(issuer?.company_email),
      blockers,documentary_gaps,
      invoice_gate:'blocked_no_verified_issue_authority',
      latest,history:reviews.slice(0,20).map(x=>({
        id:x.id,outcome:x.outcome,supply_date:x.supply_date,
        recorded_by:x.recorded_by,recorded_at:x.recorded_at
      })),more:reviews.length>20,
      issue_authorised:false,
      notice:'Human documentation only: NOT legal/tax verification, not permission '
        +'to issue, send, post or collect an invoice. No VAT rate is inferred.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Invoice issue documentary review requires migration 083.'};
    throw error;
  }finally{client.release();}
}
export async function recordInvoiceIssueReview(pool,input,actor,options={}){
  const data=validateInvoiceIssueReview(input),person=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const draft=(await client.query(DRAFT+' FOR UPDATE',
      [person.key,data.invoice_draft_id])).rows[0];
    if(!draft)throw new Error('CRM invoice draft not found in local workspace');
    if(draft.status!=='unissued_tax_review_required'||draft.invoice_number!==null||
       draft.issued_at!==null||draft.vat_treatment!=='undetermined')
      throw new Error('CRM invoice draft is not an unissued tax-undetermined record');
    const recordId=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_invoice_issue_reviews '
      +'(id,workspace_key,invoice_draft_id,outcome,supply_date,'
      +'customer_authorisation_reference,tax_evidence_reference,'
      +'payment_terms_reference,review_note,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [recordId,person.key,data.invoice_draft_id,data.outcome,data.supply_date,
       data.customer_authorisation_reference,data.tax_evidence_reference,
       data.payment_terms_reference,data.review_note,person.name]
    );
    await client.query('COMMIT');
    return {id:recordId,invoice_draft_id:data.invoice_draft_id,
      outcome:data.outcome,issue_authorised:false,
      notice:'An immutable human documentation event was recorded. '
        +'No tax treatment, invoice number, payable total, issue or payment was created.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
