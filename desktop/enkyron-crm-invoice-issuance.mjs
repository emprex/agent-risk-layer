// E09-05: ordinary invoice issuance and payment tracking, not a parallel test ledger.
// Only one manual confirmation; invariant checks live in the backend transaction.
import {randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('ENKYRON invalid local billing operator');
  return {key:'local:'+actor,name:actor};
}
function identifier(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('ENKYRON invalid '+label+' identifier');
  return value;
}
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('ENKYRON supply/payment date must be YYYY-MM-DD');
  const day=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value)
    throw new Error('ENKYRON invalid real calendar date');
  return value;
}
function textValue(value,label,min,max,optional=false){
  if(optional&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||value.length>max||CONTROL.test(value)||
      value.trim().length<min||value.trim().length>max)
    throw new Error('ENKYRON invalid '+label);
  return value.trim();
}
export function validateInvoiceIssue(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('ENKYRON invalid invoice issue request');
  if(input.confirmed!==true)
    throw new Error('ENKYRON explicit human invoice issuance confirmation is required');
  if(!Number.isInteger(input.due_days)||input.due_days<0||input.due_days>180)
    throw new Error('ENKYRON payment deadline must be 0–180 days');
  const vat_rate_percent=input.vat_rate_percent;
  if(vat_rate_percent!==0&&vat_rate_percent!==20)
    throw new Error('ENKYRON only confirmed UK no-VAT or domestic standard-rate invoices supported');
  return {
    draft_id:identifier(input.draft_id,'invoice draft'),
    supply_date:date(input.supply_date),
    due_days:input.due_days,
    vat_rate_percent,
    customer_reference:textValue(input.customer_reference,'customer reference',1,200,true),
    issuance_basis:textValue(input.issuance_basis,'human issuance basis',10,1000),
  };
}
export function validateInvoicePayment(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.confirmed!==true)
    throw new Error('ENKYRON explicit payment recording confirmation required');
  if(!Number.isSafeInteger(input.amount_minor)||input.amount_minor<=0||
      input.amount_minor>999999999)
    throw new Error('ENKYRON invalid payment amount');
  return {
    invoice_id:identifier(input.invoice_id,'invoice'),
    amount_minor:input.amount_minor,
    paid_on:date(input.paid_on),
    payment_reference:textValue(input.payment_reference,'payment reference',3,200),
  };
}
const DRAFT=
 'SELECT id,proposal_id,proposal_revision,issuer_profile_id,'
 +'issuer_legal_name,issuer_registration_number,issuer_registered_office,'
 +'buyer_legal_name,buyer_registered_address,service_description,currency,'
 +'proposed_fee_minor,status,vat_treatment,invoice_number,issued_at '
 +'FROM enkyron_crm_invoice_drafts WHERE workspace_key=$1 AND id=$2';
const ISSUER=
 'SELECT id,legal_name,registration_number,registered_office,company_email,'
 +'vat_status,vat_number FROM enkyron_operator_company_profiles '
 +'WHERE workspace_key=$1 ORDER BY revision DESC LIMIT 1';
const PROPOSAL=
 'SELECT id,revision,currency,amount_minor '
 +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2';
const LINES=
 'SELECT description,quantity,unit_price_minor,line_total_minor '
 +'FROM enkyron_crm_proposal_lines WHERE workspace_key=$1 AND proposal_id=$2 '
 +'ORDER BY position';
const INVOICE=
 'SELECT id,source_draft_id,invoice_number,issue_date::text AS issue_date,'
 +'supply_date::text AS supply_date,due_date::text AS due_date,'
 +'issuer_legal_name,issuer_registered_office,issuer_registration_number,'
 +'issuer_company_email,issuer_vat_status,issuer_vat_number,'
 +'buyer_legal_name,buyer_registered_address,service_description,'
 +'proposal_id,proposal_revision,currency,line_items,subtotal_minor,'
 +'vat_rate_percent,vat_amount_minor,total_minor,customer_reference,payment_terms,'
 +'issuance_basis,issued_by,issued_at '
 +'FROM enkyron_crm_issued_invoices WHERE workspace_key=$1 AND id=$2';

function amount(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0||n>999999999)
    throw new Error('ENKYRON invalid priced invoice amount');
  return n;
}
function sourceLines(draft,proposal,items){
  if(!proposal||Number(proposal.revision)!==Number(draft.proposal_revision)||
     proposal.currency!==draft.currency||
     Number(proposal.amount_minor)!==Number(draft.proposed_fee_minor))
    throw new Error('ENKYRON proposal revision/amount changed; invoice source must be refreshed');
  let lines=items.map(row=>({
    description:row.description,quantity:Number(row.quantity),
    unit_price_minor:Number(row.unit_price_minor),
    line_total_minor:Number(row.line_total_minor)
  }));
  if(!lines.length)lines=[{
    description:draft.service_description,quantity:1,
    unit_price_minor:amount(draft.proposed_fee_minor),
    line_total_minor:amount(draft.proposed_fee_minor)
  }];
  if(lines.length>25)throw new Error('ENKYRON too many invoice lines');
  let total=0;
  for(const line of lines){
    if(typeof line.description!=='string'||line.description.trim().length<5||
       line.description.length>500||!Number.isSafeInteger(line.quantity)||
       line.quantity<1||line.quantity>10000||!Number.isSafeInteger(line.unit_price_minor)||
       line.unit_price_minor<1||line.line_total_minor!==line.quantity*line.unit_price_minor)
      throw new Error('ENKYRON invalid priced proposal line');
    total+=line.line_total_minor;
  }
  if(total!==amount(draft.proposed_fee_minor))
    throw new Error('ENKYRON invoice lines do not match the proposal fee');
  return lines;
}
function blockers(draft,issuer,proposal){
  const issues=[];
  if(!draft)issues.push('Invoice source not found');
  else{
    if(draft.status!=='unissued_tax_review_required'||draft.invoice_number!==null||
       draft.issued_at!==null||draft.vat_treatment!=='undetermined')
      issues.push('Invoice source is no longer an eligible unissued draft');
    if(/synthetic|fictional|test entity/i.test(draft.buyer_legal_name||''))
      issues.push('Synthetic buyer: official invoice issuance is not allowed');
    if(draft.currency!=='GBP')
      issues.push('Only GBP invoices supported until currency/tax rules are reviewed');
    for(const name of ['issuer_legal_name','issuer_registered_office',
                       'buyer_legal_name','buyer_registered_address','service_description'])
      if(!draft[name])issues.push('Missing '+name);
    if(!proposal||Number(proposal.revision)!==Number(draft.proposal_revision)||
       Number(proposal.amount_minor)!==Number(draft.proposed_fee_minor)||
       proposal.currency!==draft.currency)
      issues.push('Current proposal no longer matches this invoice draft');
  }
  if(!issuer)issues.push('Issuer company profile missing');
  else{
    if(!issuer.company_email)issues.push('Issuing company contact email missing');
    if(!['registered','not_registered'].includes(issuer.vat_status))
      issues.push('Issuer VAT status must be checked and established');
    if(issuer.vat_status==='registered'&&!issuer.vat_number)
      issues.push('VAT registration number missing');
    if(draft&&(issuer.legal_name!==draft.issuer_legal_name||
       issuer.registered_office!==draft.issuer_registered_office||
       (issuer.registration_number??null)!==(draft.issuer_registration_number??null)))
      issues.push('Company identity differs from the recorded invoice source');
  }
  return issues;
}
async function inputSources(client,key,draftId,{lock=false}={}){
  const draft=(await client.query(DRAFT+(lock?' FOR UPDATE':''),[key,draftId])).rows[0]??null;
  if(!draft)throw new Error('ENKYRON invoice draft not found');
  const issuer=(await client.query(ISSUER,[key])).rows[0]??null;
  const proposal=(await client.query(PROPOSAL,[key,draft.proposal_id])).rows[0]??null;
  const lines=(await client.query(LINES,[key,draft.proposal_id])).rows;
  const problems=blockers(draft,issuer,proposal);
  if(!problems.length){
    try{sourceLines(draft,proposal,lines);}catch(e){problems.push(e.message);}
  }
  return {draft,issuer,proposal,lines,problems};
}
async function invoiceDetails(client,key,id){
  const invoice=(await client.query(INVOICE,[key,id])).rows[0]??null;
  if(!invoice)return null;
  const payments=(await client.query(
    'SELECT id,amount_minor,paid_on::text AS paid_on,payment_reference,'
    +'recorded_by,recorded_at FROM enkyron_crm_invoice_payments '
    +'WHERE workspace_key=$1 AND invoice_id=$2 ORDER BY recorded_at,id',
    [key,id]
  )).rows;
  const paid=payments.reduce((sum,p)=>sum+Number(p.amount_minor),0);
  const balance=Number(invoice.total_minor)-paid;
  if(balance<0)throw new Error('ENKYRON invoice payment reconciliation failed');
  return {
    ...invoice,payments,paid_minor:paid,balance_minor:balance,
    payment_status:balance===0?'paid':paid===0?'unpaid':'part_paid'
  };
}
export async function readInvoiceIssuePreflight(pool,draftId,actor){
  const key=owner(actor).key,id=identifier(draftId,'invoice draft');
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {draft,issuer,problems}=await inputSources(client,key,id);
    const existing=(await client.query(
      'SELECT id,invoice_number FROM enkyron_crm_issued_invoices '
      +'WHERE workspace_key=$1 AND source_draft_id=$2',[key,id]
    )).rows[0]??null;
    await client.query('COMMIT');
    return {
      available:true,draft_id:id,
      issuer_vat_status:issuer?.vat_status??'unknown',
      issuer_vat_number:issuer?.vat_number??null,
      issues:existing?['An invoice already exists for this source draft']:problems,
      existing_invoice:existing,
      notice:'One deliberate issue action; never auto-issue, never send.'
    };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    if(e?.code==='42P01')return {available:false,
      notice:'Invoice issuance schema 103 not installed'};
    throw e;
  }finally{client.release();}
}
export async function issueInvoice(pool,input,actor,options={}){
  const data=validateInvoiceIssue(input),o=owner(actor),uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {draft,issuer,proposal,lines,problems}=await inputSources(
      client,o.key,data.draft_id,{lock:true}
    );
    if(problems.length)throw new Error('Cannot issue invoice: '+problems.join('; '));
    const existing=(await client.query(
      'SELECT id FROM enkyron_crm_issued_invoices WHERE workspace_key=$1 AND source_draft_id=$2',
      [o.key,data.draft_id]
    )).rows[0];
    if(existing)throw new Error('Invoice already issued for this draft; open it in the register');
    if(issuer.vat_status==='not_registered'&&data.vat_rate_percent!==0)
      throw new Error('Non-VAT-registered issuer cannot charge VAT');
    if(issuer.vat_status==='registered'&&data.vat_rate_percent!==20)
      throw new Error('Only confirmed domestic 20% VAT supported for registered issuers');
    const issueDate=(await client.query(
      "SELECT CURRENT_DATE::text AS issue_date"
    )).rows[0].issue_date;
    if(data.supply_date>issueDate)
      throw new Error('Supply date must not be later than the issue date');
    const prices=sourceLines(draft,proposal,lines);
    const subtotal=amount(draft.proposed_fee_minor);
    const vat=(subtotal*data.vat_rate_percent+50)/100|0;
    const total=subtotal+vat;
    const due=(await client.query(
      'SELECT (CURRENT_DATE + $1::integer)::text AS due_date',[data.due_days]
    )).rows[0].due_date;
    const year=Number(issueDate.slice(0,4));
    const sequence=(await client.query(
      'INSERT INTO enkyron_crm_invoice_number_sequences '
      +'(workspace_key,issue_year,last_value) VALUES($1,$2,1) '
      +'ON CONFLICT(workspace_key,issue_year) DO UPDATE '
      +'SET last_value=enkyron_crm_invoice_number_sequences.last_value+1 '
      +'RETURNING last_value',[o.key,year]
    )).rows[0].last_value;
    const number='INV-'+year+'-'+String(sequence).padStart(6,'0');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_issued_invoices '
      +'(id,workspace_key,source_draft_id,invoice_number,issue_date,supply_date,'
      +'due_date,issuer_legal_name,issuer_registered_office,issuer_registration_number,'
      +'issuer_company_email,issuer_vat_status,issuer_vat_number,buyer_legal_name,'
      +'buyer_registered_address,service_description,proposal_id,proposal_revision,'
      +'currency,line_items,subtotal_minor,vat_rate_percent,vat_amount_minor,total_minor,'
      +'customer_reference,payment_terms,issuance_basis,issued_by) '
      +'VALUES($1,$2,$3,$4,$5::date,$6::date,$7::date,$8,$9,$10,$11,$12,$13,$14,'
      +'$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28)',
      [id,o.key,draft.id,number,issueDate,data.supply_date,due,
       draft.issuer_legal_name,draft.issuer_registered_office,
       draft.issuer_registration_number,issuer.company_email,issuer.vat_status,
       issuer.vat_status==='registered'?issuer.vat_number:null,
       draft.buyer_legal_name,draft.buyer_registered_address,draft.service_description,
       draft.proposal_id,draft.proposal_revision,draft.currency,JSON.stringify(prices),
       subtotal,data.vat_rate_percent,vat,total,data.customer_reference,
       'Due '+due+' (net '+data.due_days+' days)',data.issuance_basis,o.name]
    );
    await client.query('COMMIT');
    return {id,invoice_number:number,total_minor:total,vat_amount_minor:vat,
      notice:'Invoice issued to the local financial register. No customer email sent; export the PDF and deliver it separately.'};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
export async function listIssuedInvoices(pool,search,actor){
  const key=owner(actor).key,query=boundedSearch(search);
  try{
    const rows=(await pool.query(
      'SELECT i.id,i.invoice_number,i.issue_date::text AS issue_date,'
      +'i.due_date::text AS due_date,i.buyer_legal_name,i.currency,i.total_minor,'
      +'COALESCE(SUM(p.amount_minor),0)::bigint AS paid_minor '
      +'FROM enkyron_crm_issued_invoices i '
      +'LEFT JOIN enkyron_crm_invoice_payments p '
      +'ON p.workspace_key=i.workspace_key AND p.invoice_id=i.id '
      +'WHERE i.workspace_key=$1 AND ($2=\'\' OR '
      +'POSITION(lower($2) IN lower(i.buyer_legal_name))>0 OR '
      +'POSITION(lower($2) IN lower(i.invoice_number))>0) '
      +'GROUP BY i.id ORDER BY i.issue_date DESC,i.invoice_number DESC LIMIT 101',
      [key,query]
    )).rows;
    return {available:true,items:rows.slice(0,100).map(r=>({
      ...r,balance_minor:Number(r.total_minor)-Number(r.paid_minor),
      payment_status:Number(r.paid_minor)>=Number(r.total_minor)?'paid':
        Number(r.paid_minor)>0?'part_paid':'unpaid'
    })),more:rows.length>100};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],
      notice:'Invoice issuance schema 103 not installed'};
    throw e;
  }
}
export async function readIssuedInvoice(pool,id,actor){
  const o=owner(actor),invoiceId=identifier(id,'issued invoice');
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const invoice=await invoiceDetails(client,o.key,invoiceId);
    if(!invoice)throw new Error('ENKYRON issued invoice not found');
    await client.query('COMMIT');
    return {available:true,invoice};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
export async function recordInvoicePayment(pool,input,actor,options={}){
  const data=validateInvoicePayment(input),o=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Serialise simultaneous payment receipts without mutating immutable invoice fields.
    const invoice=(await client.query(
      'SELECT id,total_minor FROM enkyron_crm_issued_invoices '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',[o.key,data.invoice_id]
    )).rows[0];
    if(!invoice)throw new Error('ENKYRON issued invoice not found');
    const existing=(await client.query(
      'SELECT 1 FROM enkyron_crm_invoice_payments '
      +'WHERE workspace_key=$1 AND invoice_id=$2 AND payment_reference=$3',
      [o.key,data.invoice_id,data.payment_reference]
    )).rows[0];
    if(existing)throw new Error('This payment reference is already recorded');
    const paid=(await client.query(
      'SELECT COALESCE(SUM(amount_minor),0)::bigint AS total '
      +'FROM enkyron_crm_invoice_payments '
      +'WHERE workspace_key=$1 AND invoice_id=$2',[o.key,data.invoice_id]
    )).rows[0];
    const remaining=Number(invoice.total_minor)-Number(paid.total);
    if(data.amount_minor>remaining)
      throw new Error('Payment exceeds the outstanding invoice balance');
    const id=(options.uuid??randomUUID)();
    await client.query(
      'INSERT INTO enkyron_crm_invoice_payments '
      +'(id,workspace_key,invoice_id,amount_minor,paid_on,payment_reference,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5::date,$6,$7)',
      [id,o.key,data.invoice_id,data.amount_minor,data.paid_on,
       data.payment_reference,o.name]
    );
    await client.query('COMMIT');
    return {id,invoice_id:data.invoice_id,paid_minor:data.amount_minor,
      balance_minor:remaining-data.amount_minor,
      notice:'Payment reference recorded manually; no funds moved or bank reconciliation performed.'};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
