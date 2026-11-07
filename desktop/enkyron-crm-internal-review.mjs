// ENKYRON manual internal review of a specific commercial proposal revision.
// This does NOT approve issuance, tax position, legal validity or any security test.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS=new Set(['needs_changes','internal_draft_approved']);
const FORBIDDEN=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function proposalId(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid proposal ID');
  return value;
}
export function validateInternalDecision(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid internal review request');
  if(input.confirmed!==true)
    throw new Error('CRM human review confirmation required');
  if(!ACTIONS.has(input.decision))throw new Error('CRM invalid review decision');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid proposal revision');
  if(typeof input.review_note!=='string'||input.review_note.length>2000||
     FORBIDDEN.test(input.review_note)||input.review_note.trim().length<30)
    throw new Error('CRM review note must be 30 to 2000 characters');
  return {proposal_id:proposalId(input.proposal_id),
    expected_revision:input.expected_revision,decision:input.decision,
    review_note:input.review_note.trim()};
}

// These are DOCUMENTED prerequisites, not verified company/tax/contract claims.
// The snapshot refs identify which exact immutable records informed the human.
async function readiness(db,key,proposal){
  const params=[key,proposal.id,proposal.revision];
  const [issuer,buyer,terms,tax]=await Promise.all([
    db.query('SELECT id,revision,legal_name FROM enkyron_operator_company_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1',[key]),
    db.query('SELECT id,company_id FROM enkyron_crm_proposal_buyer_reviews '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 LIMIT 1',params),
    db.query('SELECT id,valid_until::text AS valid_until,'
      +'(valid_until>=CURRENT_DATE) AS still_valid '
      +'FROM enkyron_crm_proposal_commercial_terms '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 LIMIT 1',params),
    db.query('SELECT id,buyer_type,uk_vat_registration FROM enkyron_crm_proposal_tax_reviews '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 1',params)
  ]);
  const ir=issuer.rows[0]??null,br=buyer.rows[0]??null,
    tr=terms.rows[0]??null,vr=tax.rows[0]??null;
  const blockers=[];
  const amount=Number(proposal.amount_minor);
  if(!Number.isSafeInteger(amount)||amount<1||amount>999999999)
    blockers.push('Proposal price requires review');
  if(!ir)blockers.push('Issuing company profile is missing');
  if(!br)blockers.push('Current revision lacks an explicitly linked buyer documentary record');
  if(!tr)blockers.push('Current revision has no recorded commercial terms');
  else if(!tr.still_valid)blockers.push('Commercial validity date has expired');
  if(!vr)blockers.push('Current revision has no manual tax research note');
  return {
    blockers,can_approve_internal:blockers.length===0,
    evidence:{
      issuer_profile_id:ir?.id??null,
      buyer_review_id:br?.id??null,
      terms_id:tr?.id??null,
      tax_review_id:vr?.id??null
    },
    tax_notice:'Tax research is NOT a tax determination, even when present.',
    legal_notice:'Buyer and issuer details are operator-entered, NOT independently verified.'
  };
}
const PROPOSAL='SELECT id,revision,title,amount_minor,currency '
  +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2';
const DECISIONS='SELECT id,proposal_revision,decision,review_note,recorded_by,'
  +'recorded_at,issuer_profile_id,buyer_review_id,terms_id,tax_review_id '
  +'FROM enkyron_crm_proposal_internal_decisions '
  +'WHERE workspace_key=$1 AND proposal_id=$2 '
  +'ORDER BY proposal_revision DESC LIMIT 21';

export async function readInternalReview(pool,id,actor){
  const scope=owner(actor),proposal_id=proposalId(id);
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proposal=(await client.query(PROPOSAL,[scope.key,proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const support=await readiness(client,scope.key,proposal);
    const decisions=(await client.query(DECISIONS,[scope.key,proposal_id])).rows;
    await client.query('COMMIT');
    return {available:true,proposal_id,proposal_revision:proposal.revision,
      proposal_title:proposal.title,amount_minor:proposal.amount_minor,
      currency:proposal.currency,...support,
      current:decisions.find(x=>x.proposal_revision===proposal.revision)??null,
      history:decisions.slice(0,20).map(x=>({
        proposal_revision:x.proposal_revision,decision:x.decision,
        recorded_by:x.recorded_by,recorded_at:x.recorded_at
      })),
      more:decisions.length>20,
      notice:'INTERNAL DRAFT review only. No quote sent, legal/tax decision, contract, invoice or assessment.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')
      return {available:false,notice:'Internal review requires ENKYRON migration 080 and earlier schemas.'};
    throw error;
  }finally{client.release();}
}

export async function recordInternalDecision(pool,input,actor,options={}){
  const data=validateInternalDecision(input),scope=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const proposal=(await client.query(PROPOSAL+' FOR UPDATE',
      [scope.key,data.proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; reopen the internal review');
    const existing=(await client.query(
      'SELECT id FROM enkyron_crm_proposal_internal_decisions '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3',
      [scope.key,data.proposal_id,data.expected_revision]
    )).rows[0];
    if(existing)throw new Error('CRM internal decision already recorded for this revision');
    const support=await readiness(client,scope.key,proposal);
    if(data.decision==='internal_draft_approved'&&!support.can_approve_internal)
      throw new Error('CRM internal draft approval blocked by missing current-revision evidence');
    const id=(options.uuid??randomUUID)();
    const ref=support.evidence;
    await client.query(
      'INSERT INTO enkyron_crm_proposal_internal_decisions '
      +'(id,workspace_key,proposal_id,proposal_revision,decision,review_note,'
      +'issuer_profile_id,buyer_review_id,terms_id,tax_review_id,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id,scope.key,data.proposal_id,data.expected_revision,data.decision,
       data.review_note,ref.issuer_profile_id,ref.buyer_review_id,ref.terms_id,
       ref.tax_review_id,scope.actor]
    );
    await client.query('COMMIT');
    return {id,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
      decision:data.decision,
      notice:'Internal DRAFT review recorded. It does not authorise quotation issuance, tax, contracts, invoicing or testing.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
