// Company dossier 360: one read-only, repeatable snapshot of EXPLICIT links.
// No client inference by name/domain, no legacy imports, no status changes or emails.
// Local OS operator scoping is NOT remotely authenticated multi-tenant RBAC.
import {requireCompanyId} from './enkyron-crm-tickets.mjs';

const MAX_ITEMS=20;
const ownerKey=(actor)=>{
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
};
function preview(rows){
  if(!Array.isArray(rows))throw new Error('CRM invalid dossier results');
  const count=rows.length?Number(rows[0].total_rows):0;
  if(!Number.isSafeInteger(count)||count<rows.length||count<0||
    rows.length>MAX_ITEMS+1)throw new Error('CRM invalid dossier count');
  const items=rows.slice(0,MAX_ITEMS).map(({total_rows,...item})=>item);
  return {total:count,items,more:count>MAX_ITEMS};
}
const LISTS={
  contacts:
    'SELECT id,full_name,job_title,email,marketing_permission,'
    +'count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_contacts WHERE workspace_key=$1 AND company_id=$2 '
    +'ORDER BY created_at DESC,id DESC LIMIT 21',
  prospects:
    'SELECT p.id AS prospect_id,p.company_name AS candidate_name,'
    +'p.source,p.website,l.linked_at,l.linked_by,'
    +'count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_prospect_links l '
    +'JOIN sales_prospects p ON p.id=l.prospect_id '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
    +'ORDER BY l.linked_at DESC,l.id DESC LIMIT 21',
  tickets:
    'SELECT t.id AS ticket_id,t.ticket_number,t.title,t.status,t.client_name,'
    +'l.linked_at,count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_effective_ticket_links l '
    +'JOIN arl_workbench_tickets t ON t.id=l.ticket_id '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
    +'ORDER BY l.linked_at DESC,l.ticket_id DESC LIMIT 21',
  opportunities:
    'SELECT o.id AS opportunity_id,o.prospect_id,o.stage,o.next_action,'
    +'o.due_date,o.version,o.updated_at,'
    +'count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_prospect_links l '
    +'JOIN enkyron_crm_opportunities o ON o.prospect_id=l.prospect_id '
    +'AND o.workspace_key=l.workspace_key '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
    +'ORDER BY o.updated_at DESC,o.id DESC LIMIT 21',
  activities:
    'SELECT a.id,a.activity_type,a.detail,a.recorded_by,a.recorded_at,'
    +'count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_prospect_links l '
    +'JOIN enkyron_crm_opportunities o ON o.prospect_id=l.prospect_id '
    +'AND o.workspace_key=l.workspace_key '
    +'JOIN enkyron_crm_activities a ON a.opportunity_id=o.id '
    +'AND a.workspace_key=o.workspace_key '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
    +'ORDER BY a.recorded_at DESC,a.id DESC LIMIT 21',
  qualifications:
    'SELECT r.id,r.contact_id,COALESCE(c.full_name,\'Company\') AS subject,'
    +'r.fit_status,r.priority,r.rationale,r.next_action,r.source_reference,'
    +'r.recorded_by,r.recorded_at,count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_qualification_reviews r '
    +'LEFT JOIN enkyron_crm_contacts c ON c.id=r.contact_id '
    +'AND c.workspace_key=r.workspace_key AND c.company_id=r.company_id '
    +'WHERE r.workspace_key=$1 AND r.company_id=$2 '
    +'ORDER BY r.recorded_at DESC,r.id DESC LIMIT 21',
  drafts:
    'SELECT d.id,d.subject,d.recipient_email,d.revision,d.updated_at,'
    +'count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_prospect_links l '
    +'JOIN enkyron_crm_opportunities o ON o.prospect_id=l.prospect_id '
    +'AND o.workspace_key=l.workspace_key '
    +'JOIN enkyron_crm_mail_drafts d ON d.opportunity_id=o.id '
    +'AND d.workspace_key=o.workspace_key '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
    +'ORDER BY d.updated_at DESC,d.id DESC LIMIT 21',

  // Existing commercial source records only. Drafts are NOT contracts, accepted
  // offers, invoices, payments, delivered projects or customer communications.
  // The linkage is reviewed prospect -> scoped opportunity -> source records.
  commercial_docs:
    'WITH linked_opportunities AS ('
    +'SELECT o.id FROM enkyron_crm_prospect_links l '
    +'JOIN enkyron_crm_opportunities o ON o.prospect_id=l.prospect_id '
    +'AND o.workspace_key=l.workspace_key '
    +'WHERE l.workspace_key=$1 AND l.company_id=$2), '
    +'docs AS ('
    +"SELECT 'proposal_draft'::text AS document_kind,p.id AS document_id,"
    +"p.title AS title,'internal_unaccepted_draft'::text AS status,"
    +'p.revision,p.updated_at AS recorded_at,p.id AS proposal_id '
    +'FROM enkyron_crm_proposal_drafts p '
    +'JOIN linked_opportunities o ON o.id=p.opportunity_id '
    +'WHERE p.workspace_key=$1 UNION ALL '
    +"SELECT 'prebilling_worksheet',w.id,w.proposal_title,w.status,"
    +'w.proposal_revision,w.recorded_at,w.proposal_id '
    +'FROM enkyron_crm_billing_worksheets w '
    +'JOIN enkyron_crm_proposal_drafts p ON p.id=w.proposal_id '
    +'AND p.workspace_key=w.workspace_key '
    +'JOIN linked_opportunities o ON o.id=p.opportunity_id '
    +'WHERE w.workspace_key=$1 UNION ALL '
    +"SELECT 'unissued_invoice_draft',i.id,i.service_description,i.status,"
    +'i.proposal_revision,i.recorded_at,i.proposal_id '
    +'FROM enkyron_crm_invoice_drafts i '
    +'JOIN enkyron_crm_proposal_drafts p ON p.id=i.proposal_id '
    +'AND p.workspace_key=i.workspace_key '
    +'JOIN linked_opportunities o ON o.id=p.opportunity_id '
    +'WHERE i.workspace_key=$1) '
    +'SELECT document_kind,document_id,title,status,revision,recorded_at,'
    +'proposal_id,count(*) OVER() AS total_rows FROM docs '
    +'ORDER BY recorded_at DESC,document_kind,document_id LIMIT 21',
  audit_events:
    'SELECT e.resource_kind,e.resource_id,e.event_type,e.actor_local,e.created_at,'
    +'count(*) OVER() AS total_rows FROM enkyron_crm_events e '
    +'WHERE e.workspace_key=$1 AND ('
    +"(e.resource_kind='company' AND e.resource_id=$2) OR "
    +"(e.resource_kind='contact' AND EXISTS("
    +'SELECT 1 FROM enkyron_crm_contacts c WHERE c.workspace_key=e.workspace_key '
    +'AND c.id=e.resource_id AND c.company_id=$2))) '
    +'ORDER BY e.created_at DESC,e.id DESC LIMIT 21',
  audit_changes:
    'SELECT r.resource_kind,r.resource_id,r.old_version,r.new_version,'
    +'r.changed_fields,r.actor_local,r.recorded_at,count(*) OVER() AS total_rows '
    +'FROM enkyron_crm_record_changes r WHERE r.workspace_key=$1 AND ('
    +"(r.resource_kind='company' AND r.resource_id=$2) OR "
    +"(r.resource_kind='contact' AND EXISTS("
    +'SELECT 1 FROM enkyron_crm_contacts c WHERE c.workspace_key=r.workspace_key '
    +'AND c.id=r.resource_id AND c.company_id=$2))) '
    +'ORDER BY r.recorded_at DESC,r.id DESC LIMIT 21'
};
export async function getCompanyDossier(pool,id,operator){
  const companyId=requireCompanyId(id),key=ownerKey(operator);
  const client=await pool.connect();
  let inTx=false;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTx=true;
    const company=(await client.query(
      'SELECT id,name,legal_name,website,sector,city,country,'
      +'relationship_state,created_at,updated_at '
      +'FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
      [key,companyId]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    const sections={};
    for(const [name,sql] of Object.entries(LISTS)){
      sections[name]=preview((await client.query(sql,[key,companyId])).rows);
    }
    await client.query('COMMIT');
    inTx=false;
    return {available:true,company,sections,
      notice:'Only recorded company contacts and explicitly reviewed links are included. '
        +'Commercial stages and manual notes are not independently verified. '
        +'Commercial document entries are internal drafts, not accepted contracts, '
        +'issued invoices, completed projects or exchanged emails.'};
  }catch(error){
    if(inTx)await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'Some CRM modules are not installed. Review local setup before opening this dossier.'};
    throw error;
  }finally{client.release();}
}
