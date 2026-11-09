// E07-04A: read-only planning view for a future Statement of Work.
// Uses the CURRENT proposal revision, historical catalog source versions,
// and exact operator-entered draft terms. No SOW approval or work permission.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function workspace(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
}
function proposalId(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid proposal ID');
  return value;
}
function amount(value,label){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>999999999)
    throw new Error('CRM invalid SOW source '+label);
  return n;
}
const PROPOSAL=[
 'SELECT d.id,d.revision,d.title,d.scope_text,d.currency,d.amount_minor,',
 'o.company_name_at_creation,',
 "CASE WHEN o.company_id IS NOT NULL THEN 'crm_company' ELSE 'research_candidate' END AS buyer_origin,",
 'CASE WHEN o.company_id IS NOT NULL AND o.source_ticket_id IS NULL THEN TRUE WHEN o.company_id IS NOT NULL THEN EXISTS(',
 ' SELECT 1 FROM enkyron_crm_effective_ticket_links e',
 ' WHERE e.workspace_key=d.workspace_key AND e.company_id=o.company_id',
 ' AND e.ticket_id=o.source_ticket_id)',
 ' ELSE EXISTS(SELECT 1 FROM enkyron_crm_prospect_links l',
 ' WHERE l.workspace_key=d.workspace_key AND l.prospect_id=o.prospect_id)',
 ' END AS effective_origin ',
 'FROM enkyron_crm_proposal_drafts d',
 ' JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id',
 ' AND o.workspace_key=d.workspace_key',
 ' WHERE d.workspace_key=$1 AND d.id=$2'
].join('');
const LINES='SELECT l.position,l.description,l.quantity,l.unit_price_minor,l.line_total_minor,'
 +'l.source_catalog_id,l.source_catalog_revision,'
 +'v.service_code,v.name AS service_name,v.inclusions,v.exclusions,'
 +'v.deliverables,v.prerequisites,v.technical_notes '
 +'FROM enkyron_crm_proposal_lines l '
 +'LEFT JOIN enkyron_crm_service_catalog_versions v '
 +'ON v.workspace_key=l.workspace_key AND v.service_id=l.source_catalog_id '
 +'AND v.revision=l.source_catalog_revision '
 +'WHERE l.workspace_key=$1 AND l.proposal_id=$2 '
 +'ORDER BY l.position ASC LIMIT 26';
const TERMS='SELECT id,valid_until::text AS valid_until,'
 +'(valid_until>=CURRENT_DATE) AS still_valid,payment_terms,delivery_terms,'
 +'exclusions,assumptions,source_reference,review_status '
 +'FROM enkyron_crm_proposal_commercial_terms '
 +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 LIMIT 1';
const CURRENT_SOW='SELECT id,sow_revision,status,content_sha256,'
 +'acceptance_criteria,target_inventory '
 +'FROM enkyron_crm_sow_draft_versions '
 +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
 +'ORDER BY sow_revision DESC LIMIT 1';
const CONTRACT_TABLE="SELECT to_regclass('public.enkyron_crm_contract_references') IS NOT NULL AS installed";
const CONTRACT_HISTORY='SELECT id,proposal_revision,sow_revision,document_kind,source_reference,'
 +'review_note,evidence_status,recorded_by,recorded_at '
 +'FROM enkyron_crm_contract_references '
 +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
 +'ORDER BY recorded_at DESC,id DESC LIMIT 11';
// E07-05A: this module holds no authenticated contract/signature evidence.
// These statuses are research/action prompts, never assertions that a legal
// agreement is absent outside ENKYRON, and never authorization to test.
function contractChecklist(hasSow){
 return [
   {code:'nda',label:'NDA / confidentiality',
    status:'applicability_not_assessed',
    note:'Whether a standalone NDA is required must be reviewed by a human; no signed NDA is evidenced here.'},
   {code:'agreement',label:'Master service agreement / engagement contract',
    status:'not_evidenced_in_workflow',
    note:'No independently checked signed engagement or authorised client signatory is evidenced in this workflow.'},
   {code:'dpa',label:'Data processing agreement',
    status:'applicability_not_assessed',
    note:'Assess controller/processor roles and personal-data processing before deciding whether a DPA is needed.'},
   {code:'exclusions',label:'Scope and exclusions',
    status:hasSow?'draft_only_unapproved':'sow_not_documented',
    note:hasSow?'Current proposal has an operator-authored SOW draft, not approved exclusions.'
      :'No current-revision structured SOW draft; proposal text alone is not accepted scope.'},
   {code:'right_to_test',label:'Explicit written right to security-test',
    status:'not_authorised',
    note:'Active tests require separate verified authority, bounded targets, permitted methods and agreed rules of engagement.'}
 ];
}

// E07-05C: terminal documentary checkpoint, not a source of signature authority.
// A claimed reference never establishes contractual validity or a right to test.
export function contractReadiness(proposalRevision,sow,references,registry){
 if(!Number.isSafeInteger(proposalRevision)||proposalRevision<1||
    !Array.isArray(references)||typeof registry!=='boolean')
  throw new Error('CRM invalid contractual checkpoint input');
 const current=Boolean(sow&&Number.isSafeInteger(sow.sow_revision)&&
   sow.sow_revision>=1&&sow.status==='operator_draft_unapproved');
 const matched=registry&&current?references.filter(x=>x&&
   x.proposal_revision===proposalRevision&&x.sow_revision===sow.sow_revision&&
   x.evidence_status==='operator_reference_unverified'):[];
 const requirements=[
   ...(!current?['Current revision SOW is not documented.']:[]),
   'Contracting-party identity and signatory authority not independently verified.',
   'Client acceptance of the current SOW not independently authenticated.',
   'Signed engagement agreement not independently verified.',
   'NDA necessity and DPA/personal-data roles not assessed.',
   'Bounded permission and rules of engagement for active tests not independently verified.'
 ];
 return {decision:'BLOCKED_EXTERNAL_VERIFICATION',
   proposal_revision:proposalRevision,sow_revision:current?sow.sow_revision:null,
   current_unverified_reference_count:matched.length,requirements,
   can_accept_engagement:false,can_sign:false,can_start_project:false,
   assessment_authorised:false,testing_authorised:false};
}
export async function readSowSources(pool,id,actor){
  const key=workspace(actor),pid=proposalId(id),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const p=(await client.query(PROPOSAL,[key,pid])).rows[0];
    if(!p)throw new Error('CRM proposal not found in local workspace');
    if(!Number.isSafeInteger(p.revision)||p.revision<1||
       !['GBP','EUR','USD'].includes(p.currency)||
       typeof p.scope_text!=='string'||p.scope_text.trim().length<20)
      throw new Error('CRM invalid proposal SOW source');
    const fee=amount(p.amount_minor,'amount');
    const rows=(await client.query(LINES,[key,pid])).rows;
    if(rows.length>25)throw new Error('CRM SOW source has too many quote lines');
    const lines=rows.map((row,i)=>{
      if(row.position!==i+1)throw new Error('CRM SOW source line position changed');
      const quantity=Number(row.quantity),unit=amount(row.unit_price_minor,'unit price'),
        total=Number(row.line_total_minor);
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000||
         !Number.isSafeInteger(total)||total!==quantity*unit||
         typeof row.description!=='string'||row.description.trim().length<5)
        throw new Error('CRM invalid SOW source line');
      if(row.source_catalog_id&&(
        !UUID.test(row.source_catalog_id)||
        !Number.isSafeInteger(Number(row.source_catalog_revision))||
        Number(row.source_catalog_revision)<1||!row.service_code||
        !row.inclusions||!row.exclusions||!row.deliverables||!row.prerequisites))
        throw new Error('CRM missing immutable catalog source version');
      if(!row.source_catalog_id&&row.source_catalog_revision!==null)
        throw new Error('CRM invalid SOW source provenance');
      return {
        position:i+1,description:row.description,quantity,
        unit_price_minor:unit,line_total_minor:total,
        provenance:row.source_catalog_id?{
          service_code:row.service_code,
          service_name:row.service_name,
          source_catalog_id:row.source_catalog_id,
          source_catalog_revision:Number(row.source_catalog_revision),
          inclusions:row.inclusions,exclusions:row.exclusions,
          deliverables:row.deliverables,prerequisites:row.prerequisites,
          technical_notes:row.technical_notes
        }:null
      };
    });
    if(lines.length&&lines.reduce((sum,l)=>sum+l.line_total_minor,0)!==fee)
      throw new Error('CRM SOW source total does not match the saved quote');
    const terms=(await client.query(TERMS,[key,pid,p.revision])).rows[0]??null;
    const sow=(await client.query(CURRENT_SOW,[key,pid,p.revision])).rows[0]??null;
    if(sow&&(sow.status!=='operator_draft_unapproved'||
      !Number.isSafeInteger(sow.sow_revision)||sow.sow_revision<1||
      !/^[a-f0-9]{64}$/.test(sow.content_sha256)))
      throw new Error('CRM invalid current SOW draft documentary record');
    // The preview still functions on Debian before migration 101.
    const registry=(await client.query(CONTRACT_TABLE)).rows[0]?.installed===true;
    const references=registry?
      (await client.query(CONTRACT_HISTORY,[key,pid,p.revision])).rows:[];
    await client.query('COMMIT');
    const blockers=[];
    if(p.buyer_origin==='crm_company'&&p.effective_origin!==true)
      blockers.push('Reviewed company-ticket association is no longer effective');
    if(p.buyer_origin==='research_candidate')
      blockers.push('Buyer remains a research candidate, not a verified contracting party');
    if(!lines.length)
      blockers.push('No priced quote lines to map to services');
    if(lines.some(l=>!l.provenance))
      blockers.push(sow
        ? 'Custom quote line(s) have no linked catalog version; manual correspondence with the unapproved SOW still needs review'
        : 'Custom quote line(s) have no linked catalog version or current structured SOW for manual scope review');
    if(!terms)blockers.push('No commercial terms recorded for current proposal revision');
    else if(terms.still_valid!==true)
      blockers.push('Recorded commercial validity has expired');
    if(!sow)
      blockers.push('SOW acceptance criteria and technical targets are not separately documented');
    else
      blockers.push('Current SOW draft is documented but NOT independently approved or accepted');
    blockers.push('Client signature and explicit permission for any security testing are NOT established');
    const contract_decision=contractReadiness(p.revision,sow,references,registry);
    return {
      available:true,proposal_id:pid,proposal_revision:p.revision,
      title:p.title,scope_text:p.scope_text,currency:p.currency,amount_minor:fee,
      buyer_label:p.company_name_at_creation,buyer_origin:p.buyer_origin,
      effective_origin:p.effective_origin===true,
      lines,
      current_sow:sow?{
        id:sow.id,sow_revision:sow.sow_revision,
        content_sha256:sow.content_sha256,status:sow.status,
        acceptance_criteria:sow.acceptance_criteria,
        target_inventory:sow.target_inventory
      }:null,
      contract_checks:contractChecklist(Boolean(sow)),
      contract_decision,
      contract_registry_installed:registry,
      contract_references:references.slice(0,10).map(x=>({
        ...x,is_current_sow:Boolean(sow&&x.sow_revision===sow.sow_revision)
      })),
      contract_references_more:references.length>10,
      can_record_contract_reference:Boolean(registry&&sow),
      can_accept_engagement:false,
      lines_sow_documented: Boolean(sow),
      terms:terms?{
        id:terms.id,valid_until:terms.valid_until,still_valid:terms.still_valid===true,
        payment_terms:terms.payment_terms,delivery_terms:terms.delivery_terms,
        exclusions:terms.exclusions,assumptions:terms.assumptions,
        source_reference:terms.source_reference,
        review_status:terms.review_status
      }:null,blockers,
      can_approve_sow:false,can_sign:false,testing_authorised:false,
      notice:'READ ONLY SOW/CONTRACT PREVIEW. Signed agreement, NDA/DPA applicability and test authority require separate human verification.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'SOW source preview requires installed proposal, catalogue and terms schema. No write performed.'};
    throw error;
  }finally{client.release();}
}
