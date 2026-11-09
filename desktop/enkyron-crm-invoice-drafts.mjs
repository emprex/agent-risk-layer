// ENKYRON invoice DRAFT register. Not an invoice issuing or payment system.
// Every record is an immutable snapshot of an existing approved billing worksheet.
// Tax treatment remains undetermined: no VAT amount, invoice number or total is invented.
import {randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function uuid(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid '+label);
  return value;
}
function amountMinor(value){
  const amount=Number(value);
  if(!Number.isSafeInteger(amount)||amount<1||amount>999999999)
    throw new Error('CRM invoice draft fee is invalid');
  return amount;
}
export function validateInvoiceDraft(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid invoice draft request');
  if(input.confirmed!==true)
    throw new Error('CRM human invoice draft confirmation required');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid invoice draft proposal revision');
  if(typeof input.preparation_note!=='string'||input.preparation_note.length>1500||
     CONTROL.test(input.preparation_note)||input.preparation_note.trim().length<30)
    throw new Error('CRM invoice draft note requires 30 to 1500 characters');
  return {
    proposal_id:uuid(input.proposal_id,'proposal ID'),
    worksheet_id:uuid(input.worksheet_id,'worksheet ID'),
    expected_revision:input.expected_revision,
    preparation_note:input.preparation_note.trim()
  };
}
const PROPOSAL='SELECT id,title,revision,currency,amount_minor '
  +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2';
const WORKSHEET='SELECT id,proposal_revision,source_approval_id,issuer_profile_id,'
  +'buyer_review_id,terms_id,tax_review_id,proposal_title,currency,proposed_fee_minor '
  +'FROM enkyron_crm_billing_worksheets '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3';
// Provenance for the exact selected proposal. No name matching, prospect
// creation, or buyer verification is performed in this read-only lookup.
const ORIGIN_FOR_PROPOSAL=
  'SELECT o.prospect_id,o.company_id,o.source_ticket_id '
  +'FROM enkyron_crm_proposal_drafts d '
  +'JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id '
  +'AND o.workspace_key=d.workspace_key '
  +'WHERE d.workspace_key=$1 AND d.id=$2';
const ISSUER='SELECT id,legal_name,registration_number,registered_office '
  +'FROM enkyron_operator_company_profiles WHERE workspace_key=$1 AND id=$2';
const BUYER='SELECT id,legal_name,registered_address '
  +'FROM enkyron_crm_proposal_buyer_reviews WHERE workspace_key=$1 AND id=$2';
const EXISTING='SELECT id FROM enkyron_crm_invoice_drafts '
  +'WHERE workspace_key=$1 AND source_worksheet_id=$2';
// A scoped, single-snapshot preflight. These are the actual tables used by
// each stage; never infer readiness from the research prospect's display name.
const CHECKLIST=`SELECT
  EXISTS(SELECT 1 FROM enkyron_operator_company_profiles i
    WHERE i.workspace_key=$1) AS issuer_profile,
  EXISTS(SELECT 1 FROM enkyron_crm_proposal_drafts d
    JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id
      AND o.workspace_key=d.workspace_key
    WHERE d.workspace_key=$1 AND d.id=$2
      AND (
        EXISTS(SELECT 1 FROM enkyron_crm_prospect_links l
          WHERE l.workspace_key=d.workspace_key AND l.prospect_id=o.prospect_id)
        OR (o.company_id IS NOT NULL AND (o.source_ticket_id IS NULL OR
          EXISTS(SELECT 1 FROM enkyron_crm_effective_ticket_links e
            WHERE e.workspace_key=d.workspace_key
              AND e.company_id=o.company_id
              AND e.ticket_id=o.source_ticket_id)))
      )) AS company_link,
  EXISTS(SELECT 1 FROM enkyron_crm_proposal_buyer_reviews b
    WHERE b.workspace_key=$1 AND b.proposal_id=$2
      AND b.proposal_revision=$3) AS buyer_review,
  EXISTS(SELECT 1 FROM enkyron_crm_proposal_commercial_terms t
    WHERE t.workspace_key=$1 AND t.proposal_id=$2
      AND t.proposal_revision=$3) AS terms_recorded,
  EXISTS(SELECT 1 FROM enkyron_crm_proposal_commercial_terms t
    WHERE t.workspace_key=$1 AND t.proposal_id=$2
      AND t.proposal_revision=$3 AND t.valid_until>=CURRENT_DATE) AS terms_valid,
  EXISTS(SELECT 1 FROM enkyron_crm_proposal_tax_reviews x
    WHERE x.workspace_key=$1 AND x.proposal_id=$2
      AND x.proposal_revision=$3) AS tax_review,
  (SELECT a.decision FROM enkyron_crm_proposal_internal_decisions a
    WHERE a.workspace_key=$1 AND a.proposal_id=$2
      AND a.proposal_revision=$3 LIMIT 1) AS internal_decision`;
function readinessSteps(checks,worksheet,existing,origin=null){
  const decision=checks?.internal_decision??null;
  const direct=Boolean(origin?.company_id);
  return [
    {key:'issuer',action:'issuer',label:'Issuing company profile',
      ready:checks?.issuer_profile===true,
      detail:'Enter the operator-issued legal profile; it remains unverified.'},
    {key:'link',action:direct?'company':'research',
      label:direct?(origin?.source_ticket_id?'Reviewed company-ticket association':'Recorded CRM company')
        :'Associate prospect with a CRM company',
      ready:checks?.company_link===true,
      detail:direct
        ?'Original CRM company-ticket link must still be effective. Review the ticket association in Companies & Contacts.'
        :'Explicit operator link required; similar names are not proof.'},
    {key:'buyer',action:'buyer',label:'Buyer identity review',
      ready:checks?.buyer_review===true,
      detail:'Document the linked company for the current proposal revision.'},
    {key:'terms',action:checks?.terms_recorded===true&&checks?.terms_valid!==true?'proposal':'terms',label:'Commercial terms',
      ready:checks?.terms_valid===true,
      detail:checks?.terms_recorded===true
        ?'Commercial validity has expired; revise the proposal and terms.'
        :'Record payment, delivery and exclusions for this revision.'},
    {key:'tax',action:'tax',label:'International tax review',
      ready:checks?.tax_review===true,
      detail:'Record human tax research; this is not a tax determination.'},
    {key:'internal',action:decision==='needs_changes'?'proposal':'internal',label:'Internal draft review',
      ready:decision==='internal_draft_approved',
      detail:decision==='needs_changes'
        ?'Changes requested: revise the proposal before a new decision.'
        :'Human internal-draft decision required; not permission to issue.'},
    {key:'worksheet',action:'worksheet',label:'Billing worksheet',
      ready:Boolean(worksheet),
      detail:'Record pre-billing preparation for the approved revision.'}
  ];
}
function safeParty(name,address,label){
  if(typeof name!=='string'||name.trim().length<2||name.length>160||
     typeof address!=='string'||address.trim().length<10||address.length>600)
    throw new Error('CRM invoice draft '+label+' documentary fields are incomplete');
}
function eligible(proposal,worksheet,issuer,buyer){
  if(!worksheet)return 'Current proposal has no approved billing worksheet';
  if(worksheet.proposal_revision!==proposal.revision)
    return 'Billing worksheet is for a different proposal revision';
  if(worksheet.currency!==proposal.currency||
     amountMinor(worksheet.proposed_fee_minor)!==amountMinor(proposal.amount_minor))
    return 'Billing worksheet fee or currency does not match current proposal';
  if(!issuer)return 'Recorded issuer profile is not available in this local workspace';
  if(!buyer)return 'Recorded buyer dossier is not available in this local workspace';
  safeParty(issuer.legal_name,issuer.registered_office,'issuer');
  safeParty(buyer.legal_name,buyer.registered_address,'buyer');
  return null;
}
function publicSnapshot(issuer,buyer){
  return {
    issuer:{legal_name:issuer.legal_name,registration_number:issuer.registration_number,
      registered_office:issuer.registered_office},
    buyer:{legal_name:buyer.legal_name,registered_address:buyer.registered_address}
  };
}
export async function readInvoicePreparation(pool,proposalId,actor){
  const id=uuid(proposalId,'proposal ID'),person=scope(actor),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proposal=(await client.query(PROPOSAL,[person.key,id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const origin=(await client.query(
      ORIGIN_FOR_PROPOSAL,[person.key,id])).rows[0];
    if(!origin?.prospect_id&&!origin?.company_id)
      throw new Error('CRM proposal has no recorded research or CRM company origin');
    const checks=(await client.query(
      CHECKLIST,[person.key,id,proposal.revision])).rows[0];
    if(!checks)throw new Error('CRM invoice prerequisite status unavailable');
    const worksheet=(await client.query(WORKSHEET,[person.key,id,proposal.revision])).rows[0]??null;
    let issuer=null,buyer=null,existing=null;
    if(worksheet){
      issuer=(await client.query(ISSUER,[person.key,worksheet.issuer_profile_id])).rows[0]??null;
      buyer=(await client.query(BUYER,[person.key,worksheet.buyer_review_id])).rows[0]??null;
      existing=(await client.query(EXISTING,[person.key,worksheet.id])).rows[0]??null;
    }
    const blocker=eligible(proposal,worksheet,issuer,buyer);
    const steps=readinessSteps(checks,worksheet,existing,origin);
    const incomplete=steps.filter(step=>!step.ready);
    await client.query('COMMIT');
    return {
      available:true,proposal_id:id,proposal_revision:proposal.revision,
      prospect_id:origin.prospect_id??null,
      company_id:origin.company_id??null,
      source_ticket_id:origin.source_ticket_id??null,
      origin_kind:origin.company_id?(origin.source_ticket_id?'reviewed_company_ticket':'crm_company_direct'):'reviewed_research_prospect',
      proposal_title:proposal.title,currency:proposal.currency,
      proposed_fee_minor:amountMinor(proposal.amount_minor),
      worksheet_id:worksheet?.id??null,
      can_prepare:!blocker&&!existing&&!incomplete.length,
      steps,
      blockers:[...incomplete.map(s=>s.label+': '+s.detail),
        ...(blocker?[blocker]:[]),
        ...(existing?['Invoice draft already exists for this worksheet']:[])],
      current_draft_id:existing?.id??null,
      ...(issuer&&buyer?publicSnapshot(issuer,buyer):{issuer:null,buyer:null}),
      vat_treatment:'undetermined',
      notice:'INTERNAL UNISSUED draft only. Tax, invoice number, amount due and '
        +'payment status are NOT determined. Identities remain operator-entered.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'ENKYRON invoice draft schema 082 is not installed or a prerequisite is missing.'};
    throw error;
  }finally{client.release();}
}
export async function recordInvoiceDraft(pool,input,actor,options={}){
  const data=validateInvoiceDraft(input),person=scope(actor),client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Serialize with proposal revisions to prevent stale fee or buyer snapshots.
    const proposal=(await client.query(PROPOSAL+' FOR UPDATE',
      [person.key,data.proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; reopen invoice preparation');
    const worksheet=(await client.query(WORKSHEET+' FOR KEY SHARE',
      [person.key,data.proposal_id,data.expected_revision])).rows[0];
    if(!worksheet||worksheet.id!==data.worksheet_id)
      throw new Error('CRM invoice draft requires current approved billing worksheet');
    const checks=(await client.query(
      CHECKLIST,[person.key,data.proposal_id,data.expected_revision])).rows[0];
    if(!checks||readinessSteps(checks,worksheet,null).some(step=>!step.ready))
      throw new Error('CRM invoice draft blocked by incomplete current-revision prerequisites');
    const [issuer,buyer,prior]=await Promise.all([
      client.query(ISSUER+' FOR KEY SHARE',[person.key,worksheet.issuer_profile_id]),
      client.query(BUYER+' FOR KEY SHARE',[person.key,worksheet.buyer_review_id]),
      client.query(EXISTING,[person.key,worksheet.id])
    ]);
    const sourceIssuer=issuer.rows[0]??null,sourceBuyer=buyer.rows[0]??null;
    const blocker=eligible(proposal,worksheet,sourceIssuer,sourceBuyer);
    if(blocker)throw new Error('CRM invoice draft blocked: '+blocker);
    if(prior.rows.length)
      throw new Error('CRM invoice draft already recorded for this worksheet');
    if(!['GBP','EUR','USD'].includes(proposal.currency))
      throw new Error('CRM invalid draft currency');
    const fee=amountMinor(proposal.amount_minor);
    const snapshot=publicSnapshot(sourceIssuer,sourceBuyer);
    const id=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_invoice_drafts ('
      +'id,workspace_key,source_worksheet_id,proposal_id,proposal_revision,'
      +'source_approval_id,issuer_profile_id,buyer_review_id,terms_id,tax_review_id,'
      +'issuer_legal_name,issuer_registration_number,issuer_registered_office,'
      +'buyer_legal_name,buyer_registered_address,service_description,'
      +'currency,proposed_fee_minor,preparation_note,recorded_by'
      +') VALUES('+Array.from({length:20},(_,i)=>'$'+(i+1)).join(',')+')',
      [id,person.key,worksheet.id,data.proposal_id,data.expected_revision,
       worksheet.source_approval_id,worksheet.issuer_profile_id,
       worksheet.buyer_review_id,worksheet.terms_id,worksheet.tax_review_id,
       snapshot.issuer.legal_name,snapshot.issuer.registration_number,
       snapshot.issuer.registered_office,snapshot.buyer.legal_name,
       snapshot.buyer.registered_address,proposal.title,proposal.currency,
       fee,data.preparation_note,person.actor]
    );
    await client.query('COMMIT');
    return {id,status:'unissued_tax_review_required',
      notice:'Internal invoice draft recorded. No invoice number, tax calculation, '
       +'amount due, external send, payment or assessment was created.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
export async function listInvoiceDrafts(pool,search,actor){
  const query=boundedSearch(search),person=scope(actor);
  try{
    // Existing immutable draft snapshots remain untouched after invoice issue.
    // Join the real invoice where migration 103 is present, so operators see
    // one linked commercial record instead of two unrelated "drafts".
    const base=
      'SELECT d.id,d.proposal_id,d.proposal_revision,d.service_description,'
      +'d.issuer_legal_name,d.buyer_legal_name,d.currency,d.proposed_fee_minor,'
      +'d.status,d.vat_treatment,d.recorded_at,';
    const tail=
      ' FROM enkyron_crm_invoice_drafts d '
      +"WHERE d.workspace_key=$1 AND ($2='' OR "
      +'POSITION(lower($2) IN lower(d.buyer_legal_name))>0 OR '
      +'POSITION(lower($2) IN lower(d.service_description))>0) '
      +'ORDER BY d.recorded_at DESC,d.id DESC LIMIT 101';
    let rows;
    try{
      rows=(await pool.query(
        base+'i.id AS issued_invoice_id,i.invoice_number AS issued_invoice_number '
        +'FROM enkyron_crm_invoice_drafts d LEFT JOIN enkyron_crm_issued_invoices i '
        +'ON i.workspace_key=d.workspace_key AND i.source_draft_id=d.id '
        +tail.slice(' FROM enkyron_crm_invoice_drafts d '.length),
        [person.key,query]
      )).rows;
    }catch(e){
      if(e?.code!=='42P01')throw e;
      rows=(await pool.query(
        base+'NULL::text AS issued_invoice_id,NULL::text AS issued_invoice_number '
        +tail,[person.key,query]
      )).rows;
    }
    return {available:true,items:rows.slice(0,100),more:rows.length>100,
      notice:'Prepared invoice sources with linked issued invoices where available.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],
      notice:'Invoice draft schema 082 has not been installed.'};
    throw error;
  }
}
export async function readInvoiceDraft(pool,draftId,actor){
  const id=uuid(draftId,'invoice draft ID'),person=scope(actor);
  try{
    const row=(await pool.query(
      'SELECT id,proposal_id,proposal_revision,source_worksheet_id,'
      +'issuer_legal_name,issuer_registration_number,issuer_registered_office,'
      +'buyer_legal_name,buyer_registered_address,service_description,'
      +'currency,proposed_fee_minor,vat_treatment,vat_amount_minor,'
      +'invoice_total_minor,invoice_number,issued_at,status,preparation_note,'
      +'recorded_by,recorded_at '
      +'FROM enkyron_crm_invoice_drafts WHERE workspace_key=$1 AND id=$2',
      [person.key,id]
    )).rows[0];
    if(!row)throw new Error('CRM invoice draft not found in local workspace');
    return {available:true,draft:row,
      notice:'This document is unissued and NOT a tax invoice or payment request.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Invoice draft schema 082 is not installed.'};
    throw error;
  }
}
