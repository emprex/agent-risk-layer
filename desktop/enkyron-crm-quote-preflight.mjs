// E07-03A: read-only quote issuance preflight, NOT issue, send or legal approval.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sourceSql=[
  'SELECT d.id,d.revision,d.title,d.amount_minor,d.currency,o.company_id,',
  'CASE WHEN o.company_id IS NOT NULL THEN o.company_id ELSE',
  ' (SELECT l.company_id FROM enkyron_crm_prospect_links l',
  ' WHERE l.workspace_key=d.workspace_key AND l.prospect_id=o.prospect_id)',
  ' END AS buyer_company_id,',
  'CASE WHEN o.company_id IS NOT NULL AND o.source_ticket_id IS NULL THEN TRUE WHEN o.company_id IS NOT NULL THEN EXISTS(',
  ' SELECT 1 FROM enkyron_crm_effective_ticket_links e',
  ' WHERE e.workspace_key=d.workspace_key AND e.company_id=o.company_id',
  ' AND e.ticket_id=o.source_ticket_id) ELSE EXISTS(',
  ' SELECT 1 FROM enkyron_crm_prospect_links l',
  ' WHERE l.workspace_key=d.workspace_key AND l.prospect_id=o.prospect_id)',
  ' END AS effective_origin FROM enkyron_crm_proposal_drafts d',
  ' JOIN enkyron_crm_opportunities o ON o.id=d.opportunity_id',
  ' AND o.workspace_key=d.workspace_key',
  ' WHERE d.workspace_key=$1 AND d.id=$2'
].join('');
const issuerSql='SELECT id FROM enkyron_operator_company_profiles '
  +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1';
const buyerSql='SELECT id,company_id,review_status FROM enkyron_crm_proposal_buyer_reviews '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3';
const termsSql='SELECT id,review_status,(valid_until>=CURRENT_DATE) AS valid_now '
  +'FROM enkyron_crm_proposal_commercial_terms '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3';
const taxSql='SELECT id FROM enkyron_crm_proposal_tax_reviews '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'ORDER BY recorded_at DESC,id DESC LIMIT 1';
const internalSql='SELECT id,decision,issuer_profile_id,buyer_review_id,terms_id,tax_review_id '
  +'FROM enkyron_crm_proposal_internal_decisions '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3';
const linesSql='SELECT count(*)::int AS n,COALESCE(sum(line_total_minor),0)::text AS total '
  +'FROM enkyron_crm_proposal_lines WHERE workspace_key=$1 AND proposal_id=$2';
function record(label,exists,detail){
  return {label,state:exists?'documented':'blocked',detail};
}
export async function readQuoteIssuePreflight(pool,proposalId,actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  if(typeof proposalId!=='string'||!UUID.test(proposalId))
    throw new Error('CRM invalid proposal ID');
  const workspace='local:'+actor,client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const p=(await client.query(sourceSql,[workspace,proposalId])).rows[0];
    if(!p)throw new Error('CRM proposal not found in local workspace');
    const args=[workspace,proposalId,p.revision];
    const issuer=(await client.query(issuerSql,[workspace])).rows[0];
    const buyer=(await client.query(buyerSql,args)).rows[0];
    const terms=(await client.query(termsSql,args)).rows[0];
    const tax=(await client.query(taxSql,args)).rows[0];
    const internal=(await client.query(internalSql,args)).rows[0];
    const lines=(await client.query(linesSql,[workspace,proposalId])).rows[0];
    await client.query('COMMIT');
    const origin=p.effective_origin===true&&Boolean(p.buyer_company_id);
    const validBuyer=origin&&buyer?.company_id===p.buyer_company_id
      &&buyer?.review_status==='operator_documented_unverified';
    const priced=lines?.n>0&&BigInt(lines.total)===BigInt(p.amount_minor);
    // An old content approval must not appear CURRENT if its exact issuer,
    // buyer, terms or tax source has been superseded, expired or unlinked.
    // The historical immutable approval remains in the audit log.
    const currentApproval=internal?.decision==='internal_draft_approved'
      &&Boolean(issuer?.id&&buyer?.id&&terms?.id&&tax?.id)
      &&internal.issuer_profile_id===issuer.id
      &&internal.buyer_review_id===buyer.id
      &&internal.terms_id===terms.id
      &&internal.tax_review_id===tax.id
      &&validBuyer&&terms.valid_now===true;
    const steps=[
      record('Reviewed client association',origin,
        'Must have a recorded CRM company or an effective reviewed historical link.'),
      record('Itemised price',priced,
        'Current line-item total must match draft fee exactly.'),
      record('Issuer profile',Boolean(issuer),
        'Operator-entered profile, not independently verified.'),
      record('Buyer documentary review',validBuyer,
        'Must match this proposal revision and linked company; unverified.'),
      record('Commercial terms',terms?.valid_now===true&&
        terms?.review_status==='operator_draft_unapproved',
        'Recorded draft terms must still be within their validity date.'),
      record('International tax review',Boolean(tax),
        'Human research record only; no tax decision.'),
      record('Internal content decision',currentApproval,
        'Approval must reference current issuer, buyer, valid terms and latest tax note; not approval to issue.')
    ];
    return {
      available:true,proposal_id:proposalId,proposal_revision:p.revision,
      proposal_title:p.title,currency:p.currency,proposed_fee_minor:p.amount_minor,
      steps,can_issue:false,issue_authorised:false,status:'blocked_not_issuable',
      blockers:[
        ...steps.filter(x=>x.state==='blocked').map(x=>x.label),
        'Legal identity independently verified: NOT IMPLEMENTED',
        'Tax position independently determined: NOT IMPLEMENTED',
        'Client-facing issue, delivery and customer acceptance: NOT IMPLEMENTED'
      ],
      notice:'READ ONLY. No quote is issued, sent, approved or signed. No VAT, '
        +'invoice, customer permission or security assessment is created.'
    };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    if(e?.code==='42P01')return {available:false,
      notice:'Preflight prerequisite table missing. Issuance blocked.'};
    throw e;
  }finally{client.release();}
}
