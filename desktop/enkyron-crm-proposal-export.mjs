// Read-only, single-snapshot source for a local DRAFT PDF export.
// No inferred buyer identity, tax, issue, acceptance or transmission.
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function localOperator(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
}
function minor(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>999999999)
    throw new Error('CRM invalid proposal export amount');
  return n;
}
export async function readProposalForDraftPdf(pool,proposalId,actor){
  if(typeof proposalId!=='string'||!ID.test(proposalId))
    throw new Error('CRM invalid proposal identifier');
  const owner=localOperator(actor);
  const client=await pool.connect();
  let tx=false;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    tx=true;
    const proposal=(await client.query(
      'SELECT d.id,d.opportunity_id,d.title,d.scope_text,d.currency,'
      +'d.amount_minor,d.revision,d.updated_at,'
      +'o.company_name_at_creation,'
      +"CASE WHEN o.company_id IS NOT NULL THEN 'crm_company' "
      +"ELSE 'research_candidate' END AS buyer_origin, "
      +'CASE WHEN o.company_id IS NOT NULL AND o.source_ticket_id IS NULL THEN TRUE WHEN o.company_id IS NOT NULL THEN EXISTS ('
      +'SELECT 1 FROM enkyron_crm_effective_ticket_links e '
      +'WHERE e.workspace_key=d.workspace_key AND e.company_id=o.company_id '
      +'AND e.ticket_id=o.source_ticket_id) ELSE FALSE '
      +'END AS current_company_association '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.id=d.opportunity_id AND o.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 AND d.id=$2',
      [owner,proposalId]
    )).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    // A company-origin draft must not be exported with its historical CRM
    // company label after the reviewed source ticket association is revoked.
    // Research-only drafts retain their explicit unverified-buyer label.
    if(proposal.buyer_origin==='crm_company'&&
       proposal.current_company_association!==true)
      throw new Error('CRM draft PDF export blocked: company source association is no longer effective');
    if(!['crm_company','research_candidate'].includes(proposal.buyer_origin))
      throw new Error('CRM invalid proposal buyer source');
    if(!['GBP','EUR','USD'].includes(proposal.currency)||
      !Number.isSafeInteger(proposal.revision)||proposal.revision<1||
      typeof proposal.title!=='string'||!proposal.title.trim()||
      typeof proposal.scope_text!=='string'||!proposal.scope_text.trim()||
      typeof proposal.company_name_at_creation!=='string')
      throw new Error('CRM invalid proposal export fields');
    const price=minor(proposal.amount_minor);
    const rows=(await client.query(
      'SELECT position,description,quantity,unit_price_minor,line_total_minor '
      +'FROM enkyron_crm_proposal_lines '
      +'WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY position LIMIT 26',[owner,proposalId]
    )).rows;
    if(rows.length>25)throw new Error('CRM proposal has too many line items');
    let total=0;
    const lines=rows.map((row,index)=>{
      const quantity=Number(row.quantity),unit=minor(row.unit_price_minor),
        lineTotal=Number(row.line_total_minor);
      if(Number(row.position)!==index+1||
        typeof row.description!=='string'||!row.description.trim()||
        !Number.isSafeInteger(quantity)||quantity<1||quantity>10000||
        !Number.isSafeInteger(lineTotal)||quantity*unit!==lineTotal)
        throw new Error('CRM inconsistent proposal export line');
      total+=lineTotal;
      return {position:index+1,description:row.description,
        quantity,unit_price_minor:unit,line_total_minor:lineTotal};
    });
    if(lines.length&&total!==price)
      throw new Error('CRM proposal total does not match saved line items');
    // One read-only snapshot for the proposal and current operator issuer.
    // Only public-facing identity fields are selected; never read UTR, VAT,
    // Tax Office Number, source notes or private financial details for a PDF.
    const issuerRows=(await client.query(
      'SELECT legal_name,registration_number,registered_office,revision,verification_status '
      +'FROM enkyron_operator_company_profiles '
      +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1',[owner]
    )).rows;
    const source=issuerRows[0]??null;
    let issuer=null;
    if(source){
      if(typeof source.legal_name!=='string'||
          source.legal_name.trim().length<2||source.legal_name.length>160||
          typeof source.registered_office!=='string'||
          source.registered_office.trim().length<10||source.registered_office.length>600||
          (source.registration_number!==null&&
            (typeof source.registration_number!=='string'||
             !source.registration_number.trim()||source.registration_number.length>80))||
          !Number.isSafeInteger(source.revision)||source.revision<1||
          source.verification_status!=='operator_entered_unverified')
        throw new Error('CRM issuer profile must be reviewed before PDF export');
      issuer={legal_name:source.legal_name,
        registration_number:source.registration_number,
        registered_office:source.registered_office,revision:source.revision,
        verification_status:'operator_entered_unverified'};
    }
    await client.query('COMMIT');
    tx=false;
    return {available:true,proposal:{
      id:proposal.id,title:proposal.title,scope_text:proposal.scope_text,
      currency:proposal.currency,amount_minor:price,
      revision:proposal.revision,updated_at:proposal.updated_at,
      research_candidate:proposal.company_name_at_creation,
      buyer_origin:proposal.buyer_origin,
      issuer,
      lines
    },notice:'Internal draft only. Issuer profile is operator-entered, not independently verified. No buyer identity, VAT or approval verified.'};
  }catch(error){
    if(tx)await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Detailed proposal export is unavailable until CRM setup is complete.'};
    throw error;
  }finally{client.release();}
}
