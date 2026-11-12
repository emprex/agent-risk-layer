// Company 360 chronological business history.
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
// Read-only union of original append-only sources, without migrating or rewriting them.
// Exact workspace/company/verified-link scoping; no inference from company display names.
// Historical notes and mail bodies are excluded; external sends remain unverified claims.
// Bounded 20-event pages; all older events remain readable through scoped pagination.
export const COMPANY_HISTORY_SQL = `WITH linked_opportunities AS (
  SELECT o.id
  FROM enkyron_crm_opportunities o
  WHERE o.workspace_key=$1 AND (
    EXISTS (
      SELECT 1 FROM enkyron_crm_prospect_links l
      WHERE l.workspace_key=o.workspace_key
        AND l.prospect_id=o.prospect_id AND l.company_id=$2
    )
    OR (
      o.company_id=$2 AND (
        o.source_ticket_id IS NULL OR EXISTS (
          SELECT 1 FROM enkyron_crm_effective_ticket_links t
          WHERE t.workspace_key=o.workspace_key
            AND t.company_id=$2 AND t.ticket_id=o.source_ticket_id
        )
      )
    )
  )
),
reviewed_tickets AS (
  SELECT t.ticket_id FROM enkyron_crm_effective_ticket_links t
  WHERE t.workspace_key=$1 AND t.company_id=$2
),
entries AS (
  SELECT e.id AS event_id,e.resource_kind,e.resource_id,
    e.event_type AS action,
    CASE WHEN e.resource_kind='company'
      THEN 'Company record'
      ELSE 'Contact: '||coalesce(c.full_name,'unverified name')
    END AS summary,
    e.actor_local,e.created_at AS recorded_at
  FROM enkyron_crm_events e
  LEFT JOIN enkyron_crm_contacts c
    ON c.workspace_key=e.workspace_key
   AND c.id=e.resource_id AND c.company_id=$2
   AND e.resource_kind='contact'
  WHERE e.workspace_key=$1 AND e.event_type NOT IN ('updated','linked')
    AND ((e.resource_kind='company' AND e.resource_id=$2)
      OR (e.resource_kind='contact' AND c.id IS NOT NULL))
  UNION ALL
  SELECT r.id,'company_contact_change',r.resource_id,'updated',
    r.resource_kind||' fields: '||array_to_string(r.changed_fields,', '),
    r.actor_local,r.recorded_at
  FROM enkyron_crm_record_changes r
  WHERE r.workspace_key=$1 AND (
    (r.resource_kind='company' AND r.resource_id=$2)
    OR (r.resource_kind='contact' AND EXISTS (
      SELECT 1 FROM enkyron_crm_contacts c
      WHERE c.workspace_key=r.workspace_key
        AND c.id=r.resource_id AND c.company_id=$2
    ))
  )
  UNION ALL
  SELECT e.id,'opportunity',o.id,e.event_type,
    'Stage: '||e.new_stage||' | Next: '||e.new_next_action,
    e.actor_local,e.created_at
  FROM enkyron_crm_opportunity_events e
  JOIN linked_opportunities o ON o.id=e.opportunity_id
  WHERE e.workspace_key=$1
  UNION ALL
  SELECT e.id,'company_followup',f.id,
    CASE WHEN e.new_status='completed' THEN 'completed'
      WHEN e.new_status='cancelled' THEN 'cancelled'
      ELSE e.event_type END,
    'Due '||e.new_due_date::text||' | '||e.new_action_text,
    e.actor_local,e.recorded_at
  FROM enkyron_crm_company_followup_events e
  JOIN enkyron_crm_company_followups f
    ON f.workspace_key=e.workspace_key AND f.id=e.followup_id
  WHERE e.workspace_key=$1 AND f.company_id=$2
  UNION ALL
  SELECT a.id,'activity',a.id,'recorded',
    'Operator-recorded '||a.activity_type||' (not verified outreach)',
    a.recorded_by,a.recorded_at
  FROM enkyron_crm_activities a
  WHERE a.workspace_key=$1 AND (
    a.company_id=$2 OR a.opportunity_id IN (
      SELECT id FROM linked_opportunities
    )
  )
  UNION ALL
  SELECT q.id,'qualification',q.id,'recorded',
    'Commercial fit: '||q.fit_status||' | Priority: '||q.priority,
    q.recorded_by,q.recorded_at
  FROM enkyron_crm_qualification_reviews q
  WHERE q.workspace_key=$1 AND q.company_id=$2
  UNION ALL
  SELECT l.id,'research_link',l.prospect_id,'linked',
    'Research candidate linked by human review',
    l.linked_by,l.linked_at
  FROM enkyron_crm_prospect_links l
  WHERE l.workspace_key=$1 AND l.company_id=$2
  UNION ALL
  SELECT l.id,'ticket_link',l.ticket_id,'linked',
    'Ticket association reviewed (not a testing authorisation)',
    l.linked_by,l.linked_at
  FROM enkyron_crm_ticket_links l
  WHERE l.workspace_key=$1 AND l.company_id=$2
  UNION ALL
  SELECT r.id,'ticket_link',r.ticket_id,'revoked',
    'Former ticket-company association revoked',
    r.revoked_by,r.revoked_at
  FROM enkyron_crm_ticket_link_revocations r
  WHERE r.workspace_key=$1 AND r.company_id=$2
  UNION ALL
  SELECT r.id,'ticket_link',r.ticket_id,'reassigned_out',
    'Ticket reassigned to a different company after review',
    r.assigned_by,r.assigned_at
  FROM enkyron_crm_ticket_reassignments r
  WHERE r.workspace_key=$1 AND r.source_company_id=$2
  UNION ALL
  SELECT r.id,'ticket_link',r.ticket_id,'reassigned_in',
    'Ticket assigned to this company after review',
    r.assigned_by,r.assigned_at
  FROM enkyron_crm_ticket_reassignments r
  WHERE r.workspace_key=$1 AND r.destination_company_id=$2
  UNION ALL
  SELECT t.id,'ticket',t.ticket_id,t.event_type,
    'Internal ticket event metadata (not an external message)',
    t.actor,t.created_at
  FROM arl_workbench_ticket_events t
  WHERE t.ticket_id IN (SELECT ticket_id FROM reviewed_tickets)
  UNION ALL
  SELECT n.id,'ticket',n.ticket_id,'note_recorded',
    'Internal ticket note metadata (content not displayed)',
    n.entered_by,n.created_at
  FROM arl_workbench_notes n
  WHERE n.ticket_id IN (SELECT ticket_id FROM reviewed_tickets)
  UNION ALL
  SELECT de.id,'mail_draft',d.id,de.event_type,
    'Internal draft revision '||de.revision::text||' (not sent)',
    de.actor_local,de.recorded_at
  FROM enkyron_crm_mail_draft_events de
  JOIN enkyron_crm_mail_drafts d
    ON d.workspace_key=de.workspace_key AND d.id=de.draft_id
  WHERE de.workspace_key=$1 AND (
    d.company_id=$2 OR d.opportunity_id IN (
      SELECT id FROM linked_opportunities
    )
  )
  UNION ALL
  SELECT s.id,'mail_draft',d.id,'external_send_reported',
    'Operator-reported external send; provider delivery not verified',
    s.recorded_by,s.recorded_at
  FROM enkyron_crm_mail_manual_sends s
  JOIN enkyron_crm_mail_drafts d
    ON d.workspace_key=s.workspace_key AND d.id=s.draft_id
  WHERE s.workspace_key=$1 AND (
    d.company_id=$2 OR d.opportunity_id IN (
      SELECT id FROM linked_opportunities
    )
  )
)
SELECT event_id,resource_kind,resource_id,action,summary,actor_local,recorded_at,
       count(*) OVER() AS total_rows
FROM entries
ORDER BY recorded_at DESC,event_id DESC
LIMIT 21
`;

const PAGE_SIZE=20;
const PAGED_SQL=COMPANY_HISTORY_SQL.replace(/LIMIT 21\s*$/, 'LIMIT 21 OFFSET $3');
if(PAGED_SQL===COMPANY_HISTORY_SQL)throw new Error('CRM Company History page SQL missing limit');

/** Bounded company-scoped read-only paging. No name-based identity inference. */
export async function getCompanyHistoryPage(pool,payload,actor){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw new Error('CRM invalid Company History page request');
  const companyId=requireCompanyId(payload.company_id);
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  const page=payload.page;
  if(!Number.isSafeInteger(page)||page<0||page>10000)
    throw new Error('CRM invalid history page');
  const key='local:'+actor;
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const company=await client.query(
      'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
      [key,companyId]
    );
    if(!company.rows[0])throw new Error('CRM company not found in local workspace');
    const result=await client.query(PAGED_SQL,[key,companyId,page*PAGE_SIZE]);
    const rows=result.rows;
    const total=rows.length?Number(rows[0].total_rows):0;
    if(!Number.isSafeInteger(total)||total<rows.length||rows.length>PAGE_SIZE+1)
      throw new Error('CRM invalid Company History result');
    await client.query('COMMIT');
    return {available:true,page,page_size:PAGE_SIZE,total,
      items:rows.slice(0,PAGE_SIZE).map(({total_rows,...item})=>item),
      more:total>(page+1)*PAGE_SIZE};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='42P01')return {available:false,
      notice:'CRM Company History schema is unavailable.',items:[]};
    throw error;
  }finally{client.release();}
}
