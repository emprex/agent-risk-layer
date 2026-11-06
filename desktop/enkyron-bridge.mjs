#!/usr/bin/env node
// ENKYRON local IPC backend. No web server, browser, active tests or LLM authority.
// Executed by the native Qt client under the local operator OS account.
import crypto from 'node:crypto';
import os from 'node:os';
import pg from 'pg';
import { boundedSearch, noteInput, requireTicketId, verifiedMaster } from './enkyron-contract.mjs';
import { readEvidenceRegister, validatedEvidenceRequest } from './enkyron-evidence-register.mjs';
import { listSalesProspects, listSalesProspectsPage, validateProspectPage } from './enkyron-crm-prospects.mjs';
import { listOpportunities, prospectOpportunity, createOpportunity, updateOpportunity, validateOpportunityCreate, validateOpportunityUpdate } from './enkyron-crm-opportunities.mjs';
import { listActivityTimeline, recordActivity, validateActivity, requireOpportunityId } from './enkyron-crm-activities.mjs';
import { listMailDrafts, readMailDraft, createMailDraft, updateMailDraft, validateDraftCreate, validateDraftUpdate } from './enkyron-crm-mail-drafts.mjs';
import { getSalesOverview } from './enkyron-crm-overview.mjs';
import { getSalesPipeline } from './enkyron-crm-pipeline.mjs';
import { getCompanyDossier } from './enkyron-crm-company-dossier.mjs';
import { recordQualificationReview, validateQualificationReview } from './enkyron-crm-qualification.mjs';
import { listProposalDrafts, readProposalDraft, createProposalDraft, updateProposalDraft, validateProposalCreate, validateProposalUpdate } from './enkyron-crm-proposals.mjs';
import { listCompanyTickets, listLinkableTickets, ticketLinkedCompany, linkTicketToCompany, validateTicketLink, requireCompanyId } from './enkyron-crm-tickets.mjs';
import { previewProspectLink, associateProspect, validateProspectLink, requireProspectId } from './enkyron-crm-link.mjs';
import { listCompanies, listContacts, createCompany, createContact, validateCompany, validateContact } from './enkyron-crm.mjs';
import {
  createDeskTicket, updateDeskTicketStatus, validateIntake, validateStatusChange,
  assignDeskTicket, archiveDeskTicket, validateAssignment, validateArchive,
  TICKET_TRANSITIONS
} from './enkyron-ticket-intake.mjs';

const socket = '/var/run/postgresql';
const database = 'arl_local';
const config = {
  host: socket, database, user: os.userInfo().username,
  connectionTimeoutMillis: 5000, max: 1
};

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

async function stdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString('utf8');
    if (Buffer.byteLength(raw, 'utf8') > 16000) throw new Error('Request exceeds size limit');
  }
  try { return JSON.parse(raw); }
  catch { throw new Error('Malformed note request'); }
}

async function ticketList(pool, query, includeArchived=false) {
  const q = boundedSearch(query);
  const rows = (await pool.query(
    `SELECT id,ticket_number,title,client_name,status,archived_at,updated_at
     FROM arl_workbench_tickets
     WHERE ($3::boolean OR archived_at IS NULL)
       AND ($1='' OR ticket_number ILIKE $2 OR title ILIKE $2
       OR client_name ILIKE $2 OR target_reference ILIKE $2)
     ORDER BY updated_at DESC,id LIMIT 101`,
    [q, '%' + q + '%', includeArchived]
  )).rows;
  return { items: rows.slice(0, 100), more: rows.length > 100 };
}

async function ticketDetails(pool, id) {
  const ticketId = requireTicketId(id);
  const ticket = (await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1', [ticketId])).rows[0];
  if (!ticket) throw new Error('Ticket not found');
  const notes = (await pool.query(
    `SELECT id,body,entered_by,created_at,source_type,source_id,source_revision
     FROM arl_workbench_notes WHERE ticket_id=$1
     ORDER BY created_at DESC,id DESC LIMIT 100`, [ticketId]
  )).rows;
  const events = (await pool.query(
    `SELECT event_type,detail,actor,created_at
     FROM arl_workbench_ticket_events WHERE ticket_id=$1
     ORDER BY created_at DESC,id DESC LIMIT 100`, [ticketId]
  )).rows;
  return { ticket, notes, events, local_operator: os.userInfo().username, allowed_statuses: ticket.archived_at ? [] : TICKET_TRANSITIONS[ticket.status] || [] };
}

async function masterDetails(pool, ticketId) {
  const { ticket } = await ticketDetails(pool, ticketId);
  if (!ticket.linked_project_id || !ticket.linked_assessment_id) {
    return { available: false, reason: 'Ticket has no linked canonical ARL assessment' };
  }
  const project = (await pool.query(
    `SELECT p.id,p.agent_assessment_id
     FROM security_projects p
     JOIN users u ON u.id=p.created_by
     WHERE p.id=$1 AND u.email LIKE '%@local.invalid'`, [ticket.linked_project_id]
  )).rows[0];
  if (!project || project.agent_assessment_id !== ticket.linked_assessment_id) {
    throw new Error('Local assessment binding is not valid');
  }
  const master = (await pool.query(
    `SELECT m.dossier_key,m.revision,m.recorded_at,m.record_type,
            m.project_id,m.assessment_id,m.system_snapshot_id,m.target_sha,
            m.document_md,m.document_sha256,
            s.project_id AS snapshot_project_id,
            s.status AS snapshot_status,s.version_identifier AS snapshot_version,
            s.assessment_configuration_json
     FROM assessment_master_dossier_revisions m
     JOIN system_snapshots s ON s.id=m.system_snapshot_id
     WHERE m.project_id=$1 AND m.assessment_id=$2
     ORDER BY m.revision DESC,m.recorded_at DESC LIMIT 1`,
    [ticket.linked_project_id, ticket.linked_assessment_id]
  )).rows[0];
  if (!master) return { available: false, reason: 'No recorded master dossier' };
  const check = verifiedMaster(master, ticket.linked_project_id, ticket.linked_assessment_id);
  return {
    available: true, project_id: ticket.linked_project_id,
    assessment_id: ticket.linked_assessment_id,
    dossier_key: master.dossier_key, revision: master.revision,
    recorded_at: master.recorded_at, snapshot_id: master.system_snapshot_id,
    snapshot_version: master.snapshot_version, snapshot_status: master.snapshot_status,
    target_sha: master.target_sha, document_md: master.document_md,
    document_sha256: check.digest, integrity: check.integrity,
    notice: 'Historical workpaper, not a new security verdict'
  };
}

async function saveNote(pool, payload) {
  const { ticketId, body } = noteInput(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket = (await client.query(
      'SELECT assessor_name,status,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [ticketId]
    )).rows[0];
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.archived_at) throw new Error('Archived ticket is read-only');
    if (ticket.status === 'closed') throw new Error('Reopen closed ticket before adding notes');
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO arl_workbench_notes
       (id,ticket_id,body,source_type,entered_by)
       VALUES($1,$2,$3,'manual',$4)`,
      [id, ticketId, body, ticket.assessor_name]
    );
    await client.query(
      `INSERT INTO arl_workbench_ticket_events
       (id,ticket_id,event_type,detail,actor)
       VALUES($1,$2,'note_added','Manual work note',$3)`,
      [crypto.randomUUID(), ticketId, ticket.assessor_name]
    );
    await client.query('UPDATE arl_workbench_tickets SET updated_at=NOW() WHERE id=$1', [ticketId]);
    await client.query('COMMIT');
    return { saved: true, id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function evidenceRegister(pool, request) {
  // The master lookup and evidence index share one immutable PostgreSQL
  // snapshot, so a concurrent revision cannot mix different assessments.
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await readEvidenceRegister(client, request, masterDetails);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function main() {
  const command = process.argv[2];
  if (!['tickets', 'tickets-archived', 'ticket', 'master', 'note', 'evidence-register', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'crm-prospects', 'crm-companies', 'crm-contacts', 'crm-create-company', 'crm-create-contact', 'crm-prospect-review', 'crm-prospect-link', 'crm-prospects-page', 'crm-company-tickets', 'crm-ticket-options', 'crm-ticket-company', 'crm-link-ticket', 'crm-opportunities', 'crm-prospect-opportunity', 'crm-create-opportunity', 'crm-update-opportunity', 'crm-activity-timeline', 'crm-record-activity', 'crm-mail-drafts', 'crm-mail-draft', 'crm-mail-create', 'crm-mail-update', 'crm-sales-overview', 'crm-sales-pipeline', 'crm-company-dossier', 'crm-record-qualification', 'crm-proposals', 'crm-proposal', 'crm-proposal-create', 'crm-proposal-update'].includes(command)) {
    throw new Error('Unsupported desktop operation');
  }
  const arg = process.argv[3] || '';
  if (['tickets', 'tickets-archived', 'crm-prospects', 'crm-companies', 'crm-ticket-options', 'crm-opportunities', 'crm-mail-drafts'].includes(command)) boundedSearch(arg);
  if (command === 'crm-company-tickets') requireCompanyId(arg);
  if (command === 'crm-company-dossier') requireCompanyId(arg);
  if (command === 'crm-proposal' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('Invalid CRM proposal ID');
  if (command === 'crm-ticket-company') requireTicketId(arg);
  if (['ticket', 'master'].includes(command)) requireTicketId(arg);
  if (command === 'crm-prospect-review') requireProspectId(arg);
  if (command === 'crm-prospect-opportunity') requireProspectId(arg);
  if (command === 'crm-activity-timeline') requireOpportunityId(arg);
  if (command === 'crm-mail-draft' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('Invalid CRM draft ID');
  const payload = ['note', 'evidence-register', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'crm-create-company', 'crm-create-contact', 'crm-prospect-link', 'crm-prospects-page', 'crm-link-ticket', 'crm-create-opportunity', 'crm-update-opportunity', 'crm-record-activity', 'crm-mail-create', 'crm-mail-update', 'crm-record-qualification', 'crm-proposal-create', 'crm-proposal-update'].includes(command) ? await stdinJson() : null;
  if (command === 'note') noteInput(payload);
  if (command === 'evidence-register') validatedEvidenceRequest(payload);
  if (command === 'create-ticket') validateIntake(payload);
  if (command === 'ticket-status') validateStatusChange(payload);
  if (command === 'ticket-assignment') validateAssignment(payload);
  if (command === 'ticket-archive') validateArchive(payload);
  if (command === 'crm-create-company') validateCompany(payload);
  if (command === 'crm-create-contact') validateContact(payload);
  if (command === 'crm-prospect-link') validateProspectLink(payload);
  if (command === 'crm-prospects-page') validateProspectPage(payload);
  if (command === 'crm-link-ticket') validateTicketLink(payload);
  if (command === 'crm-create-opportunity') validateOpportunityCreate(payload);
  if (command === 'crm-update-opportunity') validateOpportunityUpdate(payload);
  if (command === 'crm-record-activity') validateActivity(payload);
  if (command === 'crm-mail-create') validateDraftCreate(payload);
  if (command === 'crm-mail-update') validateDraftUpdate(payload);
  if (command === 'crm-record-qualification') validateQualificationReview(payload);
  if (command === 'crm-proposal-create') validateProposalCreate(payload);
  if (command === 'crm-proposal-update') validateProposalUpdate(payload);
  const readOnly = !['note', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'crm-create-company', 'crm-create-contact', 'crm-prospect-link', 'crm-link-ticket', 'crm-create-opportunity', 'crm-update-opportunity', 'crm-record-activity', 'crm-mail-create', 'crm-mail-update', 'crm-record-qualification', 'crm-proposal-create', 'crm-proposal-update'].includes(command);
  const pool = new pg.Pool({
    ...config,
    options: readOnly
      ? '-c default_transaction_read_only=on -c statement_timeout=8000'
      : '-c statement_timeout=8000 -c lock_timeout=3000'
  });
  try {
    const result =
      command === 'tickets' ? await ticketList(pool, arg) :
      command === 'tickets-archived' ? await ticketList(pool, arg, true) :
      command === 'crm-prospects' ? await listSalesProspects(pool, arg) :
      command === 'crm-prospects-page' ? await listSalesProspectsPage(pool, payload) :
      command === 'crm-companies' ? await listCompanies(pool, arg, os.userInfo().username) :
      command === 'crm-contacts' ? await listContacts(pool, arg, os.userInfo().username) :
      command === 'crm-company-tickets' ? await listCompanyTickets(pool, arg, os.userInfo().username) :
      command === 'crm-company-dossier' ? await getCompanyDossier(pool, arg, os.userInfo().username) :
      command === 'crm-record-qualification' ? await recordQualificationReview(pool, payload, os.userInfo().username) :
      command === 'crm-proposals' ? await listProposalDrafts(pool, arg, os.userInfo().username) :
      command === 'crm-proposal' ? await readProposalDraft(pool, arg, os.userInfo().username) :
      command === 'crm-proposal-create' ? await createProposalDraft(pool, payload, os.userInfo().username) :
      command === 'crm-proposal-update' ? await updateProposalDraft(pool, payload, os.userInfo().username) :
      command === 'crm-ticket-options' ? await listLinkableTickets(pool, arg, os.userInfo().username) :
      command === 'crm-ticket-company' ? await ticketLinkedCompany(pool, arg, os.userInfo().username) :
      command === 'crm-link-ticket' ? await linkTicketToCompany(pool, payload, os.userInfo().username) :
      command === 'crm-opportunities' ? await listOpportunities(pool, arg, os.userInfo().username) :
      command === 'crm-prospect-opportunity' ? await prospectOpportunity(pool, arg, os.userInfo().username) :
      command === 'crm-create-opportunity' ? await createOpportunity(pool, payload, os.userInfo().username) :
      command === 'crm-update-opportunity' ? await updateOpportunity(pool, payload, os.userInfo().username) :
      command === 'crm-activity-timeline' ? await listActivityTimeline(pool, arg, os.userInfo().username) :
      command === 'crm-record-activity' ? await recordActivity(pool, payload, os.userInfo().username) :
      command === 'crm-sales-overview' ? await getSalesOverview(pool, os.userInfo().username) :
      command === 'crm-sales-pipeline' ? await getSalesPipeline(pool, os.userInfo().username) :
      command === 'crm-mail-drafts' ? await listMailDrafts(pool, arg, os.userInfo().username) :
      command === 'crm-mail-draft' ? await readMailDraft(pool, arg, os.userInfo().username) :
      command === 'crm-mail-create' ? await createMailDraft(pool, payload, os.userInfo().username) :
      command === 'crm-mail-update' ? await updateMailDraft(pool, payload, os.userInfo().username) :
      command === 'crm-prospect-review' ? await previewProspectLink(pool, arg, os.userInfo().username) :
      command === 'crm-prospect-link' ? await associateProspect(pool, payload, os.userInfo().username) :
      command === 'crm-create-company' ? await createCompany(pool, payload, os.userInfo().username) :
      command === 'crm-create-contact' ? await createContact(pool, payload, os.userInfo().username) :
      command === 'ticket' ? await ticketDetails(pool, arg) :
      command === 'master' ? await masterDetails(pool, arg) :
      command === 'evidence-register' ? await evidenceRegister(pool, payload) :
      command === 'create-ticket' ? await createDeskTicket(pool, payload, os.userInfo().username) :
      command === 'ticket-status' ? await updateDeskTicketStatus(pool, payload) :
      command === 'ticket-assignment' ? await assignDeskTicket(pool, payload, os.userInfo().username) :
      command === 'ticket-archive' ? await archiveDeskTicket(pool, payload, os.userInfo().username) :
      await saveNote(pool, payload);
    emit({ ok: true, result });
  } finally { await pool.end(); }
}

main().catch(error => {
  const message = String(error?.message || '');
  const expected =
    /^(Invalid |Search |Note |Request |Malformed |Ticket not found|Reopen closed|Unsupported |Local assessment|Master |No recorded|Verified assessment|Status transition|title is|required|client is|request description is|Archived |Close ticket|Archive reason|Ticket already|Ticket assignment|Only the assigned|CRM )/.test(message);
  emit({ ok: false, error: expected ? message.slice(0, 250) :
    'Local PostgreSQL operation failed. Check database, permissions and migrations.' });
  process.exitCode = 1;
});
