// E07-03B2A: an operator can log a report claimed to come from an external reviewer.
// No reviewer authentication, independent legal/tax verification or quote issuance.
import {randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const COVERAGE=new Set(['not_addressed','issues_reported','covered_in_report']);
const OUTCOMES=new Set(['requires_changes','report_received']);
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
function field(value,label,min,max,optional=false){
  if(optional&&(value==null||value===''))return null;
  if(typeof value!=='string'||value.length>max||CONTROL.test(value))
    throw new Error('CRM invalid external report '+label);
  const cleaned=value.trim();
  if(cleaned.length<min||cleaned.length>max)
    throw new Error('CRM external report '+label+' must be '+min+'–'+max+' characters');
  return cleaned;
}
function date(value){
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('CRM external report date must use YYYY-MM-DD');
  const dt=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==value)
    throw new Error('CRM invalid real external report date');
  return value;
}
export function validateQuoteExternalReport(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid external report request');
  if(input.confirmed!==true)
    throw new Error('CRM explicit human report-source confirmation required');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid proposal revision');
  if(!OUTCOMES.has(input.report_outcome))
    throw new Error('CRM unsupported external report outcome');
  const result={
    proposal_id:uuid(input.proposal_id,'proposal ID'),
    expected_revision:input.expected_revision,
    expected_source_review_id:uuid(input.expected_source_review_id,'source review ID'),
    reported_reviewer_name:field(input.reported_reviewer_name,'reported reviewer name',3,160),
    reported_reviewer_organisation:field(input.reported_reviewer_organisation,'reviewer organisation',3,160,true),
    report_reference:field(input.report_reference,'report reference',3,500),
    report_date:date(input.report_date),
    issuer_coverage:input.issuer_coverage,
    buyer_coverage:input.buyer_coverage,
    tax_coverage:input.tax_coverage,
    report_outcome:input.report_outcome,
    review_note:field(input.review_note,'review explanation',30,2000)
  };
  for(const key of ['issuer_coverage','buyer_coverage','tax_coverage'])
    if(!COVERAGE.has(result[key]))throw new Error('CRM invalid external report '+key);
  return result;
}
const PROPOSAL='SELECT id,title,revision,currency,amount_minor '
  +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2';
const SOURCE='SELECT id,review_state FROM enkyron_crm_quote_evidence_reviews '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'ORDER BY recorded_at DESC,id DESC LIMIT 1';
const CURRENT='SELECT id,source_review_id,report_outcome,reported_reviewer_name,'
  +'reported_reviewer_organisation,report_reference,report_date::text AS report_date,'
  +'issuer_coverage,buyer_coverage,tax_coverage,review_note,entered_at,entered_by '
  +'FROM enkyron_crm_quote_external_reports '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'ORDER BY entered_at DESC,id DESC LIMIT 21';
const ONCE='SELECT id FROM enkyron_crm_quote_external_reports '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'AND source_review_id=$4';
export async function readQuoteExternalReport(pool,proposalId,actor){
  const person=scope(actor),id=uuid(proposalId,'proposal ID'),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proposal=(await client.query(PROPOSAL,[person.key,id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    const args=[person.key,id,proposal.revision];
    const source=(await client.query(SOURCE,args)).rows[0]??null;
    const history=(await client.query(CURRENT,args)).rows;
    await client.query('COMMIT');
    const current=history.find(row=>row.source_review_id===source?.id)??null;
    const canRecord=source?.review_state==='submitted_for_independent_review'&&!current;
    return {
      available:true,proposal_id:id,proposal_revision:proposal.revision,
      proposal_title:proposal.title,currency:proposal.currency,
      proposed_fee_minor:proposal.amount_minor,
      current_source_review_id:source?.id??null,
      source_state:source?.review_state??'not_submitted',
      latest_for_source:current,
      history:history.slice(0,20).map(({id,source_review_id,report_outcome,
        reported_reviewer_name,entered_at,entered_by})=>({
        id,source_review_id,report_outcome,reported_reviewer_name,entered_at,entered_by
      })),
      more:history.length>20,can_record:canRecord,
      can_issue:false,issue_authorised:false,
      blockers:[
        ...(!source?['No source review recorded for this revision']:
          source.review_state!=='submitted_for_independent_review'?
          ['Source references have NOT been submitted for external review']:[]),
        ...(current?['A report receipt is already recorded for the current source review']:[]),
        'Declared reviewer identity is NOT independently authenticated.',
        'No legal identity or tax treatment is verified by this receipt.',
        'Official quote issuance and sending are NOT authorised.'
      ],
      notice:'The operator logs an external report CLAIM only. No independent '
        +'authentication, legal or tax validation, quote issuance, contract or test authorisation.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'External report register migration 096 not installed; no write performed.'};
    throw error;
  }finally{client.release();}
}
export async function recordQuoteExternalReport(pool,input,actor,options={}){
  const person=scope(actor),value=validateQuoteExternalReport(input);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const proposal=(await client.query(PROPOSAL+' FOR UPDATE',
      [person.key,value.proposal_id])).rows[0];
    if(!proposal)throw new Error('CRM proposal not found in local workspace');
    if(proposal.revision!==value.expected_revision)
      throw new Error('CRM proposal revision changed; refresh external report intake');
    const args=[person.key,value.proposal_id,value.expected_revision];
    const latest=(await client.query(SOURCE,args)).rows[0];
    if(!latest||latest.id!==value.expected_source_review_id||
        latest.review_state!=='submitted_for_independent_review')
      throw new Error('CRM external report requires latest submitted source review; refresh');
    if((await client.query(ONCE,[...args,latest.id])).rows[0])
      throw new Error('CRM report receipt already recorded for this source; do not duplicate');
    const id=(options.uuid??randomUUID)();
    await client.query('INSERT INTO enkyron_crm_quote_external_reports '
      +'(id,workspace_key,proposal_id,proposal_revision,source_review_id,'
      +'reported_reviewer_name,reported_reviewer_organisation,report_reference,'
      +'report_date,issuer_coverage,buyer_coverage,tax_coverage,report_outcome,'
      +'review_note,entered_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[
        id,person.key,value.proposal_id,value.expected_revision,
        value.expected_source_review_id,value.reported_reviewer_name,
        value.reported_reviewer_organisation,value.report_reference,
        value.report_date,value.issuer_coverage,value.buyer_coverage,
        value.tax_coverage,value.report_outcome,value.review_note,person.actor
      ]);
    await client.query('COMMIT');
    return {
      id,proposal_id:value.proposal_id,proposal_revision:value.expected_revision,
      report_outcome:value.report_outcome,
      can_issue:false,issue_authorised:false,
      notice:'External report metadata logged; reviewer authenticity and findings '
        +'not independently verified. No legal, tax, quote issuance or testing decision.'
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
