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
      +'o.company_name_at_creation '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.id=d.opportunity_id AND o.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 AND d.id=$2',
      [owner,proposalId]
    )).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
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
    await client.query('COMMIT');
    tx=false;
    return {available:true,proposal:{
      id:proposal.id,title:proposal.title,scope_text:proposal.scope_text,
      currency:proposal.currency,amount_minor:price,
      revision:proposal.revision,updated_at:proposal.updated_at,
      research_candidate:proposal.company_name_at_creation,
      lines
    },notice:'Internal draft only; no legal buyer identity, VAT or approval verified.'};
  }catch(error){
    if(tx)await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Detailed proposal export is unavailable until CRM setup is complete.'};
    throw error;
  }finally{client.release();}
}
