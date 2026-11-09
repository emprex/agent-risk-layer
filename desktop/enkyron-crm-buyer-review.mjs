// ENKYRON proposal buyer dossier: manual documentary review, never automatic identity verification.
// A legacy research candidate must be linked by a human to a CRM company.
// Direct company-origin opportunities require their effective reviewed ticket link.
// Append-only snapshots are version-bound to the priced proposal; no send, VAT or acceptance.
import {randomUUID} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {workspace:'local:'+actor,name:actor};
}
function identifier(id,label){
  if(typeof id!=='string'||!UUID.test(id))
    throw new Error('CRM invalid '+label+' ID');
  return id;
}
function field(value,label,min,max,multiline=false){
  if(typeof value!=='string'||value.length>max||
    (multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value))
    throw new Error('CRM invalid buyer '+label);
  const clean=value.trim();
  if(clean.length<min||clean.length>max)
    throw new Error('CRM buyer '+label+' requires '+min+'-'+max+' characters');
  return clean;
}
export function validateBuyerReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid buyer review');
  if(input.confirmed!==true)
    throw new Error('CRM explicit manual buyer review confirmation required');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid buyer proposal revision');
  return {
    proposal_id:identifier(input.proposal_id,'proposal'),
    company_id:identifier(input.company_id,'company'),
    expected_revision:input.expected_revision,
    legal_name:field(input.legal_name,'legal name',2,160),
    registered_address:field(input.registered_address,'address',10,600,true),
    source_reference:field(input.source_reference,'source',3,500),
    review_note:field(input.review_note,'review note',30,2000,true)
  };
}
const PROPOSAL_SQL=
  'SELECT d.id,d.revision,o.company_name_at_creation AS research_candidate,'
  +'c.id AS company_id,c.name AS company_name,c.legal_name AS company_legal_name,'
  +"CASE WHEN o.company_id IS NOT NULL AND o.source_ticket_id IS NULL THEN 'crm_company_direct' WHEN o.company_id IS NOT NULL THEN 'reviewed_company_ticket' "
  +"ELSE 'reviewed_research_prospect' END AS origin_kind "
  +'FROM enkyron_crm_proposal_drafts d '
  +'JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id '
  +'AND o.workspace_key=d.workspace_key '
  +'LEFT JOIN enkyron_crm_prospect_links l '
  +'ON l.workspace_key=d.workspace_key AND l.prospect_id=o.prospect_id '
  +'LEFT JOIN enkyron_crm_companies c '
  +'ON c.workspace_key=d.workspace_key '
  +'AND c.id=COALESCE(o.company_id,l.company_id) '
  +'AND (o.company_id IS NULL OR o.source_ticket_id IS NULL OR EXISTS ('
  +'SELECT 1 FROM enkyron_crm_effective_ticket_links e '
  +'WHERE e.workspace_key=d.workspace_key AND e.company_id=o.company_id '
  +'AND e.ticket_id=o.source_ticket_id)) '
  +'WHERE d.workspace_key=$1 AND d.id=$2';
export async function readBuyerReview(pool,proposalId,actor){
  const id=identifier(proposalId,'proposal'),scope=owner(actor);
  try{
    const proposal=(await pool.query(PROPOSAL_SQL,[scope.workspace,id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const rows=(await pool.query(
      'SELECT proposal_revision,company_id,legal_name,registered_address,'
      +'source_reference,review_note,recorded_by,recorded_at,review_status '
      +'FROM enkyron_crm_proposal_buyer_reviews '
      +'WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 21',
      [scope.workspace,id]
    )).rows;
    return {available:true,proposal_id:id,proposal_revision:proposal.revision,
      research_candidate:proposal.research_candidate,
      origin_kind:proposal.origin_kind,
      linked_company:proposal.company_id && proposal.company_name ? {
        id:proposal.company_id,name:proposal.company_name,
        crm_legal_name:proposal.company_legal_name??null
      }:null,
      current:rows.find(x=>x.proposal_revision===proposal.revision)??null,
      history:rows.slice(0,20).map(x=>({
        proposal_revision:x.proposal_revision,legal_name:x.legal_name,
        source_reference:x.source_reference,recorded_by:x.recorded_by,
        recorded_at:x.recorded_at,review_status:x.review_status
      })),
      more:rows.length>20,
      notice:'Documentary information entered by an operator; NOT independently verified. '
        +'The buyer must be a reviewed CRM association: either a linked research '
        +'prospect or the still-effective company-ticket link.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,
      notice:'Buyer review requires ENKYRON schema 078; install it after backing up.'};
    throw e;
  }
}
export async function recordBuyerReview(pool,input,actor,options={}){
  const data=validateBuyerReview(input),scope=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Lock proposal revision to avoid a buyer review of a stale commercial snapshot.
    const proposal=(await client.query(PROPOSAL_SQL+' FOR UPDATE OF d',
      [scope.workspace,data.proposal_id]
    )).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; reopen current buyer review');
    if(!proposal.company_id || !proposal.company_name ||
       proposal.company_id!==data.company_id)
      throw new Error('CRM buyer requires a current reviewed CRM company association (linked and active)');
    const already=(await client.query(
      'SELECT id FROM enkyron_crm_proposal_buyer_reviews '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3',
      [scope.workspace,data.proposal_id,data.expected_revision]
    )).rows[0];
    if(already)throw new Error('CRM buyer review already recorded for this proposal revision');
    const id=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_buyer_reviews '
      +'(id,workspace_key,proposal_id,proposal_revision,company_id,'
      +'legal_name,registered_address,source_reference,review_note,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id,scope.workspace,data.proposal_id,data.expected_revision,data.company_id,
       data.legal_name,data.registered_address,data.source_reference,
       data.review_note,scope.name]
    );
    await client.query('COMMIT');
    return {id,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
      review_status:'operator_documented_unverified',
      notice:'Manual documentary record saved. No legal verification, quote issue or email.'};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
