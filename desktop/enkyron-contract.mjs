// ENKYRON desktop bridge contracts. No database connection or side effects here.
import { createHash } from 'node:crypto';

export const MAX_NOTE_LENGTH = 12000;

export function requireTicketId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('Invalid ticket identifier');
  }
  return value;
}

export function boundedSearch(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Search must be 100 characters or fewer');
  return value.trim();
}

export function noteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid note request');
  const ticketId = requireTicketId(input.ticket_id);
  if (typeof input.body !== 'string' || input.body.trim().length === 0 ||
      input.body.trim().length > MAX_NOTE_LENGTH) {
    throw new Error('Note must contain 1–12000 non-whitespace characters');
  }
  return { ticketId, body: input.body.trim() };
}

// A master document is historical evidence only, not an assessment verdict.
export function verifiedMaster(record, projectId, assessmentId) {
  if (!record) throw new Error('Master dossier not found');
  if (record.project_id !== projectId ||
      record.assessment_id !== assessmentId ||
      record.snapshot_project_id !== projectId) {
    throw new Error('Master/assessment/project identity mismatch');
  }
  const digest = createHash('sha256').update(String(record.document_md), 'utf8').digest('hex');
  if (digest !== record.document_sha256) throw new Error('Master document SHA-256 mismatch');
  let configuration;
  try {
    configuration = typeof record.assessment_configuration_json === 'string'
      ? JSON.parse(record.assessment_configuration_json)
      : record.assessment_configuration_json;
  } catch {
    throw new Error('Invalid snapshot configuration');
  }
  if (configuration?.assessmentBinding?.assessmentId !== assessmentId ||
      configuration?.targetBinding?.revision !== record.target_sha) {
    throw new Error('Master target/snapshot binding mismatch');
  }
  return { digest, integrity: 'verified' };
}
