import crypto from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';

export async function archivedAssessmentReport(pool, ticketId, actor) {
  // LA-03: read the existing immutable PostgreSQL final report only.
  // Local UNIX operator identity is supplied by the bridge, never by the UI.
  const id = requireTicketId(ticketId);
  const table = (await pool.query(
    "SELECT to_regclass('public.enkyron_assessment_final_reports') AS name"
  )).rows[0];
  if (!table?.name) return {available:false,reason:'No final report archive is installed'};

  // Scope and operator authorisation are rechecked server side.
  // No report ID or filesystem path comes from the UI.
  const rows = (await pool.query([
    "SELECT r.report_id,r.ticket_id,r.project_id,r.assessment_id,",
    "r.ticket_number,r.source_commit,r.file_name,r.mime_type,",
    "r.confidentiality,r.document_kind,r.content_sha256,",
    "r.byte_length,r.content,r.archived_by,r.archived_at",
    "FROM enkyron_assessment_final_reports r",
    "JOIN arl_workbench_tickets t ON t.id=r.ticket_id",
    "JOIN security_projects p ON p.id=r.project_id",
    "WHERE t.id=$1 AND t.target_kind='git'",
    "AND t.linked_project_id=r.project_id",
    "AND t.linked_assessment_id=r.assessment_id",
    "AND t.ticket_number=r.ticket_number",
    "AND p.agent_assessment_id=r.assessment_id",
    "AND (t.assigned_to=$2 OR t.assessor_name=$2)",
    "ORDER BY r.archived_at DESC,r.report_id DESC LIMIT 1"
  ].join('\n'),[id,actor])).rows;
  const row=rows[0];
  if (!row) return {available:false,reason:'No accessible archived report for this ticket'};

  const bytes=row.content;
  const length=Number(row.byte_length);
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(length) ||
      length<1000 || length>25000000 || bytes.length!==length ||
      !bytes.subarray(0,5).equals(Buffer.from('%PDF-')) ||
      row.mime_type!=='application/pdf' ||
      row.confidentiality!=='confidential' ||
      row.document_kind!=='final_security_assessment_report' ||
      !/^rpt_[a-f0-9]{32}$/.test(row.report_id||'') ||
      !/^[a-f0-9]{40}$/.test(row.source_commit||'') ||
      !/^[a-f0-9]{64}$/.test(row.content_sha256||'') ||
      typeof row.file_name!=='string' || row.file_name.length>255 ||
      row.file_name.length<4 ||
      crypto.createHash('sha256').update(bytes).digest('hex')!==row.content_sha256) {
    throw new Error('Archived report integrity check failed');
  }
  return {
    available:true,report_id:row.report_id,ticket_id:row.ticket_id,
    project_id:row.project_id,assessment_id:row.assessment_id,
    ticket_number:row.ticket_number,source_commit:row.source_commit,
    file_name:row.file_name,mime_type:row.mime_type,
    confidentiality:row.confidentiality,byte_length:length,
    content_sha256:row.content_sha256,archived_by:row.archived_by,
    archived_at:row.archived_at,integrity:'sha256_verified',
    // Bounded one-shot native IPC; no HTTP, stdout file path or DB mutation.
    content_base64:bytes.toString('base64')
  };
}

