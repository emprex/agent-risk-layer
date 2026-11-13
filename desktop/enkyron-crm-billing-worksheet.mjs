// ENKYRON billing preparation, NOT an invoice, payment request or tax computation.
// One immutable pre-billing worksheet per approved internal proposal revision.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function owner(actor) {
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
}
function id(value,label) {
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid '+label);
  return value;
}
export function validateBillingWorksheet(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid billing worksheet request');
  if(input.confirmed!==true)
    throw new Error('CRM billing preparation requires explicit operator confirmation');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid proposal revision');
  if(typeof input.preparation_note!=='string'||input.preparation_note.length>1500||
     CONTROL.test(input.preparation_note)||input.preparation_note.trim().length<30)
    throw new Error('CRM billing preparation note requires 30 to 1500 characters');
  return {
    proposal_id:id(input.proposal_id,'proposal ID'),
    expected_revision:input.expected_revision,
    approval_id:id(input.approval_id,'internal approval ID'),
    preparation_note:input.preparation_note.trim()
  };
}
const PROPOSAL='SELECT d.id,d.revision,d.title,d.currency,d.amount_minor,'
  +'o.company_name_at_creation AS research_candidate '
  +'FROM enkyron_crm_proposal_drafts d '
  +'JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id '
  +'AND o.workspace_key=d.workspace_key '
  +'WHERE d.workspace_key=$1 AND d.id=$2';
const APPROVAL='SELECT id,decision,proposal_revision,'
  +'issuer_profile_id,buyer_review_id,terms_id,tax_review_id '
  +'FROM enkyron_crm_proposal_internal_decisions '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3';
const WORKSHEET='SELECT id,proposal_revision,source_approval_id,'
  +'proposal_title,currency,proposed_fee_minor,preparation_note,'
  +'recorded_by,recorded_at,status '
  +'FROM enkyron_crm_billing_worksheets '
  +'WHERE workspace_key=$1 AND proposal_id=$2 '
  +'ORDER BY proposal_revision DESC LIMIT 21';
function approved(approval) {
  return Boolean(approval&&approval.decision==='internal_draft_approved'&&
    ['issuer_profile_id','buyer_review_id','terms_id','tax_review_id']
      .every(key=>typeof approval[key]==='string'&&approval[key].length>0));
}
function money(amount) {
  const n=Number(amount);
  if(!Number.isSafeInteger(n)||n<1||n>999999999)
    throw new Error('CRM proposal amount invalid for billing preparation');
  return n;
}
export async function readBillingPreparation(pool,proposalId,actor) {
  const proposal_id=id(proposalId,'proposal ID'),key=owner(actor);
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proposal=(await client.query(PROPOSAL,[key,proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const revision=proposal.revision;
    const approval=(await client.query(APPROVAL,[key,proposal_id,revision])).rows[0]??null;
    const worksheets=(await client.query(WORKSHEET,[key,proposal_id])).rows;
    await client.query('COMMIT');
    const blockers=[];
    if(!approved(approval))
      blockers.push('Current proposal revision has no complete internal draft approval');
    const amount=money(proposal.amount_minor);
    return {
      available:true,proposal_id,proposal_revision:revision,
      proposal_title:proposal.title,research_candidate:proposal.research_candidate,
      currency:proposal.currency,proposed_fee_minor:amount,
      approval_id:approved(approval)?approval.id:null,
      can_prepare:approved(approval),
      blockers,
      current:worksheets.find(w=>w.proposal_revision===revision)??null,
      history:worksheets.slice(0,20).map(w=>({
        proposal_revision:w.proposal_revision,currency:w.currency,
        proposed_fee_minor:w.proposed_fee_minor,recorded_at:w.recorded_at,
        recorded_by:w.recorded_by,status:w.status
      })),
      more:worksheets.length>20,
      notice:'PRE-BILLING ONLY: no VAT or tax amount, invoice number, '
        +'invoice issue, payment request, bank transaction, contract or assessment.'};
  }catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Billing worksheets require additive ENKYRON migration 081.'};
    throw error;
  }finally{client.release();}
}
export async function recordBillingWorksheet(pool,input,actor,options={}) {
  const data=validateBillingWorksheet(input),key=owner(actor);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const proposal=(await client.query(PROPOSAL+' FOR UPDATE OF d',
      [key,data.proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; reopen billing preparation');
    const approval=(await client.query(APPROVAL+' FOR KEY SHARE',
      [key,data.proposal_id,data.expected_revision])).rows[0];
    if(!approved(approval)||approval.id!==data.approval_id)
      throw new Error('CRM billing worksheet requires the current internal draft approval');
    const prior=(await client.query(
      'SELECT id FROM enkyron_crm_billing_worksheets '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3',
      [key,data.proposal_id,data.expected_revision]
    )).rows[0];
    if(prior)throw new Error('CRM billing worksheet already recorded for this revision');
    const fee=money(proposal.amount_minor);
    if(!['GBP','EUR','USD'].includes(proposal.currency))
      throw new Error('CRM invalid currency for billing preparation');
    const worksheetId=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_billing_worksheets '
      +'(id,workspace_key,proposal_id,proposal_revision,source_approval_id,'
      +'issuer_profile_id,buyer_review_id,terms_id,tax_review_id,'
      +'proposal_title,currency,proposed_fee_minor,preparation_note,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [worksheetId,key,data.proposal_id,data.expected_revision,approval.id,
       approval.issuer_profile_id,approval.buyer_review_id,approval.terms_id,
       approval.tax_review_id,proposal.title,proposal.currency,fee,
       data.preparation_note,actor]
    );
    await client.query('COMMIT');
    return {id:worksheetId,proposal_id:data.proposal_id,
      proposal_revision:data.expected_revision,status:'internal_prebilling_only',
      notice:'A working billing worksheet was recorded. No invoice, VAT, '
        +'payment request or accounting entry was issued.'};
  }catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
