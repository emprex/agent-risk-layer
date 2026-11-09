#!/usr/bin/env node
// ENKYRON local IPC backend. No web server, browser, active tests or LLM authority.
// Executed by the native Qt client under the local operator OS account.
import crypto from 'node:crypto';
import os from 'node:os';
import pg from 'pg';
import { boundedSearch, noteInput, requireTicketId, verifiedMaster } from './enkyron-contract.mjs';
import { readEvidenceRegister, validatedEvidenceRequest } from './enkyron-evidence-register.mjs';
import { listSalesProspects, listSalesProspectsPage, validateProspectPage } from './enkyron-crm-prospects.mjs';
import { listOpportunities, prospectOpportunity, createOpportunity, createCompanyOpportunity, createDirectCompanyOpportunity, correctCommercialOrigin, updateOpportunity, validateOpportunityCreate, validateCompanyOpportunityCreate, validateDirectCompanyOpportunityCreate, validateOriginCorrection, validateOpportunityUpdate } from './enkyron-crm-opportunities.mjs';
import { listActivityTimeline, recordActivity, validateActivity, requireOpportunityId } from './enkyron-crm-activities.mjs';
import { listMailDrafts, readMailDraft, createMailDraft, updateMailDraft, validateDraftCreate, validateDraftUpdate } from './enkyron-crm-mail-drafts.mjs';
import { getSalesOverview } from './enkyron-crm-overview.mjs';
import { getSalesPipeline } from './enkyron-crm-pipeline.mjs';
import { getCompanyDossier } from './enkyron-crm-company-dossier.mjs';
import { recordQualificationReview, validateQualificationReview } from './enkyron-crm-qualification.mjs';
import { listProposalDrafts, readProposalDraft, createProposalDraft, updateProposalDraft, validateProposalCreate, validateProposalUpdate } from './enkyron-crm-proposals.mjs';
import { readProposalLines, replaceProposalLines, validateProposalLines } from './enkyron-crm-proposal-lines.mjs';
import { readProposalForDraftPdf } from './enkyron-crm-proposal-export.mjs';
import { readSowSources } from './enkyron-crm-sow-sources.mjs';
import {readSowDraft,recordSowDraft,validateSowDraft} from './enkyron-crm-sow-drafts.mjs';
import {recordContractReference,validateContractReference} from './enkyron-crm-contract-references.mjs';
import {listServiceCatalog,readServiceCatalog,createServiceCatalog,updateServiceCatalog,validateServiceCatalog} from './enkyron-crm-service-catalog.mjs';
import { getTaxReviews, recordTaxReview, validateTaxReview } from './enkyron-crm-tax-review.mjs';
import {readCompanyProfile,recordCompanyProfile,validateCompanyProfile} from './enkyron-company-profile.mjs';
import {explainLocalError} from './enkyron-db-errors.mjs';
import {readBuyerReview,recordBuyerReview,validateBuyerReview} from './enkyron-crm-buyer-review.mjs';
import {readCommercialTerms,recordCommercialTerms,validateCommercialTerms} from './enkyron-crm-commercial-terms.mjs';
import {readInternalReview,recordInternalDecision,validateInternalDecision} from './enkyron-crm-internal-review.mjs';
import {readBillingPreparation,recordBillingWorksheet,validateBillingWorksheet} from './enkyron-crm-billing-worksheet.mjs';
import {readInvoicePreparation,recordInvoiceDraft,validateInvoiceDraft,listInvoiceDrafts,readInvoiceDraft} from './enkyron-crm-invoice-drafts.mjs';
import {readInvoiceIssueReview,recordInvoiceIssueReview,validateInvoiceIssueReview} from './enkyron-crm-invoice-issue-review.mjs';
import {readQuoteIssuePreflight} from './enkyron-crm-quote-preflight.mjs';
import {readQuoteEvidenceReview,recordQuoteEvidenceReview,validateQuoteEvidenceReview} from './enkyron-crm-quote-evidence-review.mjs';
import {readQuoteExternalReport,recordQuoteExternalReport,validateQuoteExternalReport} from './enkyron-crm-quote-external-report.mjs';
import { listCompanyTickets, listLinkableTickets, ticketLinkedCompany, linkTicketToCompany, validateTicketLink, requireCompanyId } from './enkyron-crm-tickets.mjs';
import {listContactTickets,linkContactToTicket,validateContactTicketLink,requireContactId} from './enkyron-crm-contact-tickets.mjs';
import {revokeTicketAssociation,validateTicketRevocation,listTicketRevocations} from './enkyron-crm-ticket-corrections.mjs';
import {listReassignmentCandidates,reassignTicket,validateTicketReassignment,validateReassignmentLookup} from './enkyron-crm-ticket-reassignments.mjs';
import {listPrivacyRequests,recordPrivacyRequest,validatePrivacyIntake} from './enkyron-crm-privacy.mjs';
import {listRetentionReviews,recordRetentionReview,validateRetentionReview} from './enkyron-crm-retention.mjs';
import {readCompanyCsv} from './enkyron-crm-csv.mjs';
import {beginCsvExport,finishCsvExport,listCsvExportEvents,validateExportStart,validateExportFinish} from './enkyron-crm-csv-export-audit.mjs';
import {inspectCsvImport,commitCsvImport,validateCsvPreview,validateCsvCommit} from './enkyron-crm-csv-import.mjs';
import { previewProspectLink, associateProspect, validateProspectLink, requireProspectId } from './enkyron-crm-link.mjs';
import { listCompanies, listContacts, createCompany, createContact, validateCompany, validateContact } from './enkyron-crm.mjs';
import {previewCompanyDuplicates,previewContactDuplicates} from './enkyron-crm-duplicates.mjs';
import {updateCompany,updateContact,validateCompanyEdit,validateContactEdit,listRecordChanges} from './enkyron-crm-edit.mjs';
import {listTicketActions,recordTicketAction,validateTicketAction} from './enkyron-ticket-actions.mjs';
import {recordTicketTriage,readTicketTriage,validateTicketTriage}
  from './enkyron-ticket-triage.mjs';
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

async function stdinJson(maxBytes=16000) {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString('utf8');
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new Error('Request exceeds size limit');
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
       AND ($3::boolean OR NOT EXISTS (
         SELECT 1 FROM enkyron_crm_opportunity_origin_corrections c
         WHERE c.old_source_ticket_id = arl_workbench_tickets.id
       ))
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
  const triage=await readTicketTriage(pool,ticketId);
  return { ticket, notes, events, triage,
    local_operator: os.userInfo().username,
    allowed_statuses: ticket.archived_at ? [] : TICKET_TRANSITIONS[ticket.status] || [] };
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
  if (!['tickets', 'tickets-archived', 'ticket', 'master', 'note', 'evidence-register', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'ticket-triage-save', 'ticket-actions', 'ticket-action-save', 'crm-prospects', 'crm-companies', 'crm-contacts', 'crm-company-duplicates', 'crm-contact-duplicates', 'crm-create-company', 'crm-create-contact', 'crm-edit-company', 'crm-edit-contact', 'crm-record-changes', 'crm-contact-tickets', 'crm-privacy-requests', 'crm-record-privacy-request', 'crm-retention-reviews', 'crm-record-retention-review', 'crm-link-contact-ticket', 'crm-prospect-review', 'crm-prospect-link', 'crm-prospects-page', 'crm-company-tickets', 'crm-ticket-revocations', 'crm-ticket-reassignment-options', 'crm-ticket-reassign', 'crm-revoke-ticket-link', 'crm-ticket-options', 'crm-ticket-company', 'crm-link-ticket', 'crm-opportunities', 'crm-prospect-opportunity', 'crm-create-opportunity', 'crm-company-opportunity-create', 'crm-company-direct-opportunity-create', 'crm-correct-commercial-origin', 'crm-update-opportunity', 'crm-activity-timeline', 'crm-record-activity', 'crm-mail-drafts', 'crm-mail-draft', 'crm-mail-create', 'crm-mail-update', 'crm-sales-overview', 'crm-sales-pipeline', 'crm-company-dossier', 'crm-company-csv', 'crm-csv-export-history', 'crm-csv-export-start', 'crm-csv-export-finish', 'crm-csv-import-check', 'crm-csv-import-commit', 'crm-record-qualification', 'crm-proposals', 'crm-proposal', 'crm-proposal-create', 'crm-proposal-update', 'crm-proposal-lines', 'crm-proposal-lines-save', 'crm-proposal-export', 'crm-sow-sources', 'crm-sow-draft', 'crm-sow-draft-save', 'crm-contract-reference-save', 'crm-tax-reviews', 'crm-tax-record', 'crm-own-profile', 'crm-own-profile-save', 'crm-buyer-review', 'crm-buyer-record', 'crm-commercial-terms', 'crm-commercial-record', 'crm-internal-review', 'crm-internal-decision', 'crm-billing-preparation', 'crm-billing-record', 'crm-invoice-drafts', 'crm-invoice-draft', 'crm-invoice-prepare', 'crm-invoice-record', 'crm-invoice-issue-review', 'crm-invoice-issue-record', 'crm-quote-issue-preflight', 'crm-quote-evidence-review', 'crm-quote-evidence-record', 'crm-quote-external-report', 'crm-quote-external-record', 'crm-service-catalog-list', 'crm-service-catalog-read', 'crm-service-catalog-create', 'crm-service-catalog-update'].includes(command)) {
    throw new Error('Unsupported desktop operation');
  }
  const arg = process.argv[3] || '';
  if (['tickets', 'tickets-archived', 'crm-prospects', 'crm-companies', 'crm-ticket-options', 'crm-opportunities', 'crm-mail-drafts','crm-service-catalog-list'].includes(command)) boundedSearch(arg);
  if (command === 'crm-company-tickets') requireCompanyId(arg);
  if (command === 'crm-ticket-revocations') requireCompanyId(arg);
  if (command === 'crm-contact-tickets') requireContactId(arg);
  if (command === 'crm-privacy-requests') requireContactId(arg);
  if (command === 'crm-retention-reviews') requireContactId(arg);
  if (command === 'crm-record-changes' && !/^(company|contact):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('Invalid CRM record history request');
  if (command === 'crm-company-dossier') requireCompanyId(arg);
  if (command === 'crm-company-csv') requireCompanyId(arg);
  if (command === 'crm-csv-export-history') requireCompanyId(arg);
  if (['crm-proposal','crm-proposal-lines','crm-proposal-export','crm-sow-sources','crm-sow-draft','crm-tax-reviews','crm-buyer-review','crm-commercial-terms','crm-internal-review','crm-billing-preparation','crm-invoice-draft','crm-invoice-prepare','crm-invoice-issue-review','crm-quote-issue-preflight','crm-quote-evidence-review','crm-quote-external-report','crm-service-catalog-read'].includes(command) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('Invalid CRM proposal ID');
  if (command === 'crm-ticket-company') requireTicketId(arg);
  if (['ticket', 'master', 'ticket-actions'].includes(command)) requireTicketId(arg);
  if (command === 'crm-prospect-review') requireProspectId(arg);
  if (command === 'crm-prospect-opportunity') requireProspectId(arg);
  if (command === 'crm-activity-timeline') requireOpportunityId(arg);
  if (command === 'crm-mail-draft' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('Invalid CRM draft ID');
  const payload = ['note', 'evidence-register', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'ticket-triage-save', 'ticket-action-save', 'crm-company-opportunity-create', 'crm-company-direct-opportunity-create', 'crm-correct-commercial-origin', 'crm-create-company', 'crm-create-contact', 'crm-company-duplicates', 'crm-contact-duplicates', 'crm-edit-company', 'crm-edit-contact', 'crm-prospect-link', 'crm-prospects-page', 'crm-link-ticket', 'crm-revoke-ticket-link', 'crm-ticket-reassignment-options', 'crm-ticket-reassign', 'crm-link-contact-ticket', 'crm-record-privacy-request', 'crm-record-retention-review', 'crm-csv-export-start', 'crm-csv-export-finish', 'crm-csv-import-check', 'crm-csv-import-commit', 'crm-create-opportunity', 'crm-update-opportunity', 'crm-record-activity', 'crm-mail-create', 'crm-mail-update', 'crm-record-qualification', 'crm-proposal-create', 'crm-proposal-update', 'crm-proposal-lines-save', 'crm-sow-draft-save', 'crm-contract-reference-save', 'crm-tax-record', 'crm-own-profile-save', 'crm-buyer-record', 'crm-commercial-record', 'crm-internal-decision', 'crm-billing-record', 'crm-invoice-record', 'crm-invoice-issue-record', 'crm-quote-evidence-record', 'crm-quote-external-record', 'crm-service-catalog-create', 'crm-service-catalog-update'].includes(command) ? await stdinJson(['crm-csv-import-check','crm-csv-import-commit'].includes(command) ? 350000 : 16000) : null;
  if (command === 'note') noteInput(payload);
  if (command === 'evidence-register') validatedEvidenceRequest(payload);
  if (command === 'create-ticket') validateIntake(payload);
  if (command === 'ticket-status') validateStatusChange(payload);
  if (command === 'ticket-assignment') validateAssignment(payload);
  if (command === 'ticket-archive') validateArchive(payload);
  if (command === 'ticket-triage-save') validateTicketTriage(payload);
  if (command === 'ticket-action-save') validateTicketAction(payload);
  if (['crm-create-company','crm-company-duplicates'].includes(command)) validateCompany(payload);
  if (['crm-create-contact','crm-contact-duplicates'].includes(command)) validateContact(payload);
  if (command === 'crm-edit-company') validateCompanyEdit(payload);
  if (command === 'crm-edit-contact') validateContactEdit(payload);
  if (command === 'crm-prospect-link') validateProspectLink(payload);
  if (command === 'crm-prospects-page') validateProspectPage(payload);
  if (command === 'crm-link-ticket') validateTicketLink(payload);
  if (command === 'crm-revoke-ticket-link') validateTicketRevocation(payload);
  if (command === 'crm-ticket-reassignment-options') validateReassignmentLookup(payload);
  if (command === 'crm-ticket-reassign') validateTicketReassignment(payload);
  if (command === 'crm-link-contact-ticket') validateContactTicketLink(payload);
  if (command === 'crm-record-privacy-request') validatePrivacyIntake(payload);
  if (command === 'crm-record-retention-review') validateRetentionReview(payload);
  if (command === 'crm-csv-export-start') validateExportStart(payload);
  if (command === 'crm-csv-export-finish') validateExportFinish(payload);
  if (command === 'crm-csv-import-check') validateCsvPreview(payload);
  if (command === 'crm-csv-import-commit') validateCsvCommit(payload);
  if (command === 'crm-create-opportunity') validateOpportunityCreate(payload);
  if (command === 'crm-company-opportunity-create') validateCompanyOpportunityCreate(payload);
  if (command === 'crm-company-direct-opportunity-create') validateDirectCompanyOpportunityCreate(payload);
  if (command === 'crm-correct-commercial-origin') validateOriginCorrection(payload);
  if (command === 'crm-update-opportunity') validateOpportunityUpdate(payload);
  if (command === 'crm-record-activity') validateActivity(payload);
  if (command === 'crm-mail-create') validateDraftCreate(payload);
  if (command === 'crm-mail-update') validateDraftUpdate(payload);
  if (command === 'crm-record-qualification') validateQualificationReview(payload);
  if (command === 'crm-proposal-create') validateProposalCreate(payload);
  if (command === 'crm-proposal-update') validateProposalUpdate(payload);
  if (command === 'crm-proposal-lines-save') validateProposalLines(payload);
  if (command === 'crm-sow-draft-save') validateSowDraft(payload);
  if (command === 'crm-contract-reference-save') validateContractReference(payload);
  if (command === 'crm-tax-record') validateTaxReview(payload);
  if (command === 'crm-own-profile-save') validateCompanyProfile(payload);
  if (command === 'crm-buyer-record') validateBuyerReview(payload);
  if (command === 'crm-commercial-record') validateCommercialTerms(payload);
  if (command === 'crm-internal-decision') validateInternalDecision(payload);
  if (command === 'crm-billing-record') validateBillingWorksheet(payload);
  if (command === 'crm-invoice-record') validateInvoiceDraft(payload);
  if (command === 'crm-invoice-issue-record') validateInvoiceIssueReview(payload);
  if (command === 'crm-quote-evidence-record') validateQuoteEvidenceReview(payload);
  if (command === 'crm-quote-external-record') validateQuoteExternalReport(payload);
  if (command === 'crm-service-catalog-create') validateServiceCatalog(payload);
  if (command === 'crm-service-catalog-update') validateServiceCatalog(payload, true);
  const readOnly = !['note', 'create-ticket', 'ticket-status', 'ticket-assignment', 'ticket-archive', 'ticket-triage-save', 'ticket-action-save', 'crm-company-opportunity-create', 'crm-company-direct-opportunity-create', 'crm-correct-commercial-origin', 'crm-create-company', 'crm-create-contact', 'crm-edit-company', 'crm-edit-contact', 'crm-prospect-link', 'crm-link-ticket', 'crm-revoke-ticket-link', 'crm-ticket-reassign', 'crm-link-contact-ticket', 'crm-record-privacy-request', 'crm-record-retention-review', 'crm-csv-export-start', 'crm-csv-export-finish', 'crm-csv-import-commit', 'crm-create-opportunity', 'crm-update-opportunity', 'crm-record-activity', 'crm-mail-create', 'crm-mail-update', 'crm-record-qualification', 'crm-proposal-create', 'crm-proposal-update', 'crm-proposal-lines-save', 'crm-sow-draft-save', 'crm-contract-reference-save', 'crm-tax-record', 'crm-own-profile-save', 'crm-buyer-record', 'crm-commercial-record', 'crm-internal-decision', 'crm-billing-record', 'crm-invoice-record', 'crm-invoice-issue-record', 'crm-quote-evidence-record', 'crm-quote-external-record', 'crm-service-catalog-create', 'crm-service-catalog-update'].includes(command);
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
      command === 'crm-company-duplicates' ? await previewCompanyDuplicates(pool, payload, os.userInfo().username) :
      command === 'crm-contact-duplicates' ? await previewContactDuplicates(pool, payload, os.userInfo().username) :
      command === 'crm-contacts' ? await listContacts(pool, arg, os.userInfo().username) :
      command === 'crm-company-tickets' ? await listCompanyTickets(pool, arg, os.userInfo().username) :
      command === 'crm-ticket-revocations' ? await listTicketRevocations(pool, arg, os.userInfo().username) :
      command === 'crm-ticket-reassignment-options' ? await listReassignmentCandidates(pool, payload.destination_company_id, payload.search, os.userInfo().username) :
      command === 'crm-contact-tickets' ? await listContactTickets(pool, arg, os.userInfo().username) :
      command === 'crm-privacy-requests' ? await listPrivacyRequests(pool, arg, os.userInfo().username) :
      command === 'crm-retention-reviews' ? await listRetentionReviews(pool, arg, os.userInfo().username) :
      command === 'crm-company-dossier' ? await getCompanyDossier(pool, arg, os.userInfo().username) :
      command === 'crm-company-csv' ? await readCompanyCsv(pool, arg, os.userInfo().username) :
      command === 'crm-csv-export-history' ? await listCsvExportEvents(pool, arg, os.userInfo().username) :
      command === 'crm-csv-export-start' ? await beginCsvExport(pool, payload, os.userInfo().username) :
      command === 'crm-csv-export-finish' ? await finishCsvExport(pool, payload, os.userInfo().username) :
      command === 'crm-csv-import-check' ? await inspectCsvImport(pool, payload, os.userInfo().username) :
      command === 'crm-csv-import-commit' ? await commitCsvImport(pool, payload, os.userInfo().username) :
      command === 'crm-record-qualification' ? await recordQualificationReview(pool, payload, os.userInfo().username) :
      command === 'crm-proposals' ? await listProposalDrafts(pool, arg, os.userInfo().username) :
      command === 'crm-proposal' ? await readProposalDraft(pool, arg, os.userInfo().username) :
      command === 'crm-proposal-create' ? await createProposalDraft(pool, payload, os.userInfo().username) :
      command === 'crm-proposal-update' ? await updateProposalDraft(pool, payload, os.userInfo().username) :
      command === 'crm-proposal-lines' ? await readProposalLines(pool, arg, os.userInfo().username) :
      command === 'crm-proposal-lines-save' ? await replaceProposalLines(pool, payload, os.userInfo().username) :
      command === 'crm-proposal-export' ? await readProposalForDraftPdf(pool, arg, os.userInfo().username) :
       command === 'crm-sow-sources' ? await readSowSources(pool, arg, os.userInfo().username) :
       command === 'crm-sow-draft' ? await readSowDraft(pool, arg, os.userInfo().username) :
       command === 'crm-sow-draft-save' ? await recordSowDraft(pool, payload, os.userInfo().username) :
       command === 'crm-contract-reference-save' ? await recordContractReference(pool, payload, os.userInfo().username) :
      command === 'crm-tax-reviews' ? await getTaxReviews(pool, arg, os.userInfo().username) :
      command === 'crm-tax-record' ? await recordTaxReview(pool, payload, os.userInfo().username) :
      command === 'crm-own-profile' ? await readCompanyProfile(pool, os.userInfo().username) :
      command === 'crm-own-profile-save' ? await recordCompanyProfile(pool, payload, os.userInfo().username) :
      command === 'crm-buyer-review' ? await readBuyerReview(pool, arg, os.userInfo().username) :
      command === 'crm-buyer-record' ? await recordBuyerReview(pool, payload, os.userInfo().username) :
      command === 'crm-commercial-terms' ? await readCommercialTerms(pool, arg, os.userInfo().username) :
      command === 'crm-commercial-record' ? await recordCommercialTerms(pool, payload, os.userInfo().username) :
      command === 'crm-internal-review' ? await readInternalReview(pool, arg, os.userInfo().username) :
      command === 'crm-internal-decision' ? await recordInternalDecision(pool, payload, os.userInfo().username) :
      command === 'crm-billing-preparation' ? await readBillingPreparation(pool, arg, os.userInfo().username) :
      command === 'crm-billing-record' ? await recordBillingWorksheet(pool, payload, os.userInfo().username) :
      command === 'crm-invoice-drafts' ? await listInvoiceDrafts(pool, arg, os.userInfo().username) :
      command === 'crm-invoice-draft' ? await readInvoiceDraft(pool, arg, os.userInfo().username) :
      command === 'crm-invoice-prepare' ? await readInvoicePreparation(pool, arg, os.userInfo().username) :
      command === 'crm-invoice-record' ? await recordInvoiceDraft(pool, payload, os.userInfo().username) :
      command === 'crm-quote-evidence-review' ? await readQuoteEvidenceReview(pool, arg, os.userInfo().username) :
      command === 'crm-quote-evidence-record' ? await recordQuoteEvidenceReview(pool, payload, os.userInfo().username) :
      command === 'crm-quote-external-report' ? await readQuoteExternalReport(pool, arg, os.userInfo().username) :
      command === 'crm-quote-external-record' ? await recordQuoteExternalReport(pool, payload, os.userInfo().username) :
      command === 'crm-service-catalog-list' ? await listServiceCatalog(pool, arg, os.userInfo().username) :
      command === 'crm-service-catalog-read' ? await readServiceCatalog(pool, arg, os.userInfo().username) :
      command === 'crm-service-catalog-create' ? await createServiceCatalog(pool, payload, os.userInfo().username) :
      command === 'crm-service-catalog-update' ? await updateServiceCatalog(pool, payload, os.userInfo().username) :
      command === 'crm-quote-issue-preflight' ? await readQuoteIssuePreflight(pool, arg, os.userInfo().username) :
      command === 'crm-invoice-issue-review' ? await readInvoiceIssueReview(pool, arg, os.userInfo().username) :
      command === 'crm-invoice-issue-record' ? await recordInvoiceIssueReview(pool, payload, os.userInfo().username) :
      command === 'crm-ticket-options' ? await listLinkableTickets(pool, arg, os.userInfo().username) :
      command === 'crm-ticket-company' ? await ticketLinkedCompany(pool, arg, os.userInfo().username) :
      command === 'crm-link-ticket' ? await linkTicketToCompany(pool, payload, os.userInfo().username) :
      command === 'crm-revoke-ticket-link' ? await revokeTicketAssociation(pool, payload, os.userInfo().username) :
      command === 'crm-ticket-reassign' ? await reassignTicket(pool, payload, os.userInfo().username) :
      command === 'crm-link-contact-ticket' ? await linkContactToTicket(pool, payload, os.userInfo().username) :
      command === 'crm-record-privacy-request' ? await recordPrivacyRequest(pool, payload, os.userInfo().username) :
      command === 'crm-record-retention-review' ? await recordRetentionReview(pool, payload, os.userInfo().username) :
      command === 'crm-opportunities' ? await listOpportunities(pool, arg, os.userInfo().username) :
      command === 'crm-prospect-opportunity' ? await prospectOpportunity(pool, arg, os.userInfo().username) :
      command === 'crm-create-opportunity' ? await createOpportunity(pool, payload, os.userInfo().username) :
      command === 'crm-company-opportunity-create' ? await createCompanyOpportunity(pool, payload, os.userInfo().username) :
      command === 'crm-company-direct-opportunity-create' ? await createDirectCompanyOpportunity(pool, payload, os.userInfo().username) :
      command === 'crm-correct-commercial-origin' ? await correctCommercialOrigin(pool, payload, os.userInfo().username) :
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
      command === 'crm-edit-company' ? await updateCompany(pool, payload, os.userInfo().username) :
      command === 'crm-edit-contact' ? await updateContact(pool, payload, os.userInfo().username) :
      command === 'crm-record-changes' ? await listRecordChanges(pool, arg.split(':',1)[0], arg.slice(arg.indexOf(':')+1), os.userInfo().username) :
      command === 'ticket' ? await ticketDetails(pool, arg) :
      command === 'ticket-actions' ? await listTicketActions(pool, arg) :
      command === 'master' ? await masterDetails(pool, arg) :
      command === 'evidence-register' ? await evidenceRegister(pool, payload) :
      command === 'create-ticket' ? await createDeskTicket(pool, payload, os.userInfo().username) :
      command === 'ticket-status' ? await updateDeskTicketStatus(pool, payload) :
      command === 'ticket-assignment' ? await assignDeskTicket(pool, payload, os.userInfo().username) :
      command === 'ticket-archive' ? await archiveDeskTicket(pool, payload, os.userInfo().username) :
      command === 'ticket-triage-save' ? await recordTicketTriage(pool, payload, os.userInfo().username) :
      command === 'ticket-action-save' ? await recordTicketAction(pool, payload, os.userInfo().username) :
      await saveNote(pool, payload);
    emit({ ok: true, result });
  } finally { await pool.end(); }
}

main().catch(error => {
  const message = String(error?.message || '');
  const expected =
    /^(Invalid |Search |Note |Request |Malformed |Ticket not found|Reopen closed|Unsupported |Local assessment|Master |No recorded|Verified assessment|Status transition|title is|required|client is|request description is|Archived |Close ticket|Archive reason|Ticket already|Ticket assignment|Ticket action|Closed or archived|Only the assigned|CRM )/.test(message);
  const profileOperation=['crm-own-profile','crm-own-profile-save'].includes(process.argv[2]);
  emit({ ok: false, error: profileOperation
    ? explainLocalError(error)
    : expected ? message.slice(0, 250)
    : 'Local PostgreSQL operation failed. Check database, permissions and migrations.' });
  process.exitCode = 1;
});
