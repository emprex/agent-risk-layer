// E07-03B1: immutable manual documentation for INDEPENDENT future review.
// No data in this module authenticates a person, verifies tax or authorises issue.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const STATES=new Set(['needs_changes','submitted_for_independent_review']);
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function id(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid '+label);
  return value;
}
function field(v,label,min,max,optional=false){
  if(optional&&(v===null||v===undefined||v===''))return null;
  if(typeof v!=='string'||v.length>max||CONTROL.test(v))
    throw new Error('CRM invalid quote review '+label);
  const value=v.trim();
  if(value.length<min||value.length>max)
    throw new Error('CRM quote review '+label+' requires '+min+'–'+max+' characters');
  return value;
}
export function validateQuoteEvidenceReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid quote evidence review');
  if(input.confirmed!==true)
    throw new Error('CRM explicit manual quote evidence confirmation required');
  if(!STATES.has(input.review_state))
    throw new Error('CRM unsupported quote review state');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid quote proposal revision');
  const previous=input.expected_previous_id==null?null:
    id(input.expected_previous_id,'previous quote review ID');
  const value={
    proposal_id:id(input.proposal_id,'proposal ID'),
    expected_revision:input.expected_revision,
    expected_previous_id:previous,
    review_state:input.review_state,
    issuer_source_reference:field(input.issuer_source_reference,'issuer evidence reference',3,500,true),
    buyer_source_reference:field(input.buyer_source_reference,'buyer evidence reference',3,500,true),
    tax_source_reference:field(input.tax_source_reference,'tax evidence reference',3,500,true),
    review_note:field(input.review_note,'human explanation',30,2000)
  };
  if(value.review_state==='submitted_for_independent_review' &&
    (!value.issuer_source_reference||!value.buyer_source_reference||
      !value.tax_source_reference))
    throw new Error('CRM external verification request requires three source references');
  return value;
}
const PROPOSAL='SELECT id,title,revision,currency,amount_minor '
  +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2';
const HISTORY='SELECT id,proposal_revision,previous_review_id,review_state,'
  +'issuer_source_reference,buyer_source_reference,tax_source_reference,'
  +'review_note,recorded_by,recorded_at '
  +'FROM enkyron_crm_quote_evidence_reviews '
  +'WHERE workspace_key=$1 AND proposal_id=$2 '
  +'ORDER BY proposal_revision DESC,recorded_at DESC,id DESC LIMIT 21';
const LATEST='SELECT id,review_state FROM enkyron_crm_quote_evidence_reviews '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'ORDER BY recorded_at DESC,id DESC LIMIT 1';
export async function readQuoteEvidenceReview(pool,proposalId,actor){
  const person=scope(actor),pid=id(proposalId,'proposal ID');
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const p=(await client.query(PROPOSAL,[person.key,pid])).rows[0];
    if(!p)throw new Error('CRM proposal not found in local workspace');
    const history=(await client.query(HISTORY,[person.key,pid])).rows;
    await client.query('COMMIT');
    return {
      available:true,proposal_id:pid,proposal_revision:p.revision,
      proposal_title:p.title,currency:p.currency,amount_minor:p.amount_minor,
      latest:history.find(r=>r.proposal_revision===p.revision)??null,
      history:history.slice(0,20).map(({id,proposal_revision,review_state,
        recorded_by,recorded_at})=>({id,proposal_revision,review_state,
        recorded_by,recorded_at})),
      more:history.length>20,
      can_issue:false,issue_authorised:false,
      notice:'Operator-submitted references are unverified. No external verification, '
        +'tax determination, quotation issuance, client acceptance, contract or testing permission.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Quote documentary review migration 095 is not installed. No data changed.'};
    throw error;
  }finally{client.release();}
}
export async function recordQuoteEvidenceReview(pool,input,actor,options={}){
  const person=scope(actor),data=validateQuoteEvidenceReview(input);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const p=(await client.query(PROPOSAL+' FOR UPDATE',
      [person.key,data.proposal_id])).rows[0];
    if(!p)throw new Error('CRM proposal not found in local workspace');
    if(p.revision!==data.expected_revision)
      throw new Error('CRM proposal revision changed; refresh documentary review');
    const prev=(await client.query(LATEST,
      [person.key,data.proposal_id,data.expected_revision])).rows[0]??null;
    if((prev?.id??null)!==data.expected_previous_id)
      throw new Error('CRM quote review changed concurrently; refresh before recording');
    const rid=(options.uuid??randomUUID)();
    await client.query('INSERT INTO enkyron_crm_quote_evidence_reviews '
      +'(id,workspace_key,proposal_id,proposal_revision,previous_review_id,'
      +'review_state,issuer_source_reference,buyer_source_reference,'
      +'tax_source_reference,review_note,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
        rid,person.key,data.proposal_id,data.expected_revision,
        data.expected_previous_id,data.review_state,
        data.issuer_source_reference,data.buyer_source_reference,
        data.tax_source_reference,data.review_note,person.name
      ]);
    await client.query('COMMIT');
    return {
      id:rid,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
      review_state:data.review_state,
      can_issue:false,issue_authorised:false,
      notice:'An immutable operator evidence-request note was recorded. '
        +'It does NOT establish verified identity, tax treatment, '
        +'approval to send, contract, invoice or security-test authority.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
