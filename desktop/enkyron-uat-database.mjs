// ENK-03 synthetic UAT database routing. This is an accidental-write
// interlock, NOT an authentication or multi-user authorization mechanism.
// Normal operator behaviour (no UAT variables) remains unchanged.
export const ENKYRON_UAT_MARKER = 'ENK03_SYNTHETIC_ONLY';
export const ENKYRON_ENK05_UAT_MARKER = 'ENK05_SYNTHETIC_ONLY';
export const ENKYRON_ENK05_UAT_DATABASE = 'enkyron_uat_enk05';

const DATABASE_PREFIX = /^enkyron_uat_[a-z0-9_]{1,40}$/;
// Separate and exact ENK-05 acceptance scope. Never broaden the ENK-03
// R1/R2 UAT allowlist or use its existing accepted database for ticket writes.
const ENK05_COMMANDS = new Set([
  'tickets', 'tickets-archived', 'tickets-mine', 'tickets-mine-archived',
  'ticket', 'create-ticket', 'ticket-status', 'ticket-assignment',
  'ticket-archive', 'ticket-triage-save', 'ticket-actions',
  'ticket-action-save', 'note',
  'crm-companies', 'crm-create-company', 'crm-company-dossier',
  'crm-company-history', 'crm-company-tickets', 'crm-ticket-options',
  'crm-ticket-company', 'crm-link-ticket'
]);
const UAT_COMMANDS = new Set([
  'tickets', 'tickets-mine', 'tickets-mine-archived', 'crm-sales-overview', 'crm-sales-pipeline',
  'crm-companies', 'crm-contacts',
  'crm-company-duplicates', 'crm-contact-duplicates',
  'crm-create-company', 'crm-create-contact',
  'crm-edit-company', 'crm-edit-contact',
  'crm-company-dossier', 'crm-company-history', 'crm-company-direct-opportunity-create',
  'crm-opportunities', 'crm-activity-timeline', 'crm-update-opportunity',
  'crm-record-activity', 'crm-record-qualification',
  'crm-company-proposal-readiness',
  'crm-company-proposal-create', 'crm-proposal', 'crm-proposals',
  'crm-company-proposal-versions', 'crm-company-proposal-revise',
  'crm-company-followups',
  'crm-company-followups-upcoming', 'crm-company-followup-create',
  'crm-company-followup-update',
]);

// Optional, deliberately stricter operator UX preview. This is not a
// production policy and does not make the ordinary UAT editable workflow read-only.
// It is active ONLY when paired with the exact synthetic DB and marker.
// An allowlist (not a negative list) prevents unknown operations from slipping in.
const UX_PREVIEW_READ_COMMANDS = new Set([
  'tickets', 'tickets-mine', 'tickets-mine-archived', 'crm-sales-overview', 'crm-sales-pipeline',
  'crm-companies', 'crm-contacts', 'crm-company-dossier',
  'crm-company-history', 'crm-opportunities', 'crm-activity-timeline',
  'crm-company-followups', 'crm-company-followups-upcoming',
  'crm-company-proposal-readiness', 'crm-proposal', 'crm-proposals',
  'crm-company-proposal-versions',
]);

export function requireEnkyronUxPreviewCommand(target,command,env=process.env) {
  if(!Object.hasOwn(env,'ENKYRON_UX_PREVIEW_READ_ONLY')) return;
  if(env.ENKYRON_UX_PREVIEW_READ_ONLY!=='1' || target?.uat!==true)
    throw new Error('ENKYRON UX preview requires exact synthetic UAT routing');
  if(!UX_PREVIEW_READ_COMMANDS.has(command))
    throw new Error('ENKYRON UX preview is read-only; this action is unavailable');
}

export function resolveEnkyronDatabase(env = process.env) {
  const hasName = Object.hasOwn(env, 'ENKYRON_UAT_DATABASE');
  const hasGate = Object.hasOwn(env, 'ENKYRON_UAT_GUARD');
  const hasUxPreview = Object.hasOwn(env, 'ENKYRON_UX_PREVIEW_READ_ONLY');
  if (hasUxPreview && (env.ENKYRON_UX_PREVIEW_READ_ONLY !== '1'
      || !hasName || !hasGate)) {
    throw new Error('ENKYRON UX preview requires exact synthetic UAT routing');
  }
  if (!hasName && !hasGate) {
    return Object.freeze({ database: 'arl_local', uat: false });
  }
  if (env.ENKYRON_UAT_DATABASE === ENKYRON_ENK05_UAT_DATABASE
      && env.ENKYRON_UAT_GUARD === ENKYRON_ENK05_UAT_MARKER) {
    return Object.freeze({ database: ENKYRON_ENK05_UAT_DATABASE,
      uat: true, marker: ENKYRON_ENK05_UAT_MARKER });
  }
  if (env.ENKYRON_UAT_GUARD !== ENKYRON_UAT_MARKER
      || !DATABASE_PREFIX.test(env.ENKYRON_UAT_DATABASE || '')) {
    throw new Error('ENKYRON UAT requires a synthetic-only acknowledgement and an enkyron_uat_ database');
  }
  return Object.freeze({ database: env.ENKYRON_UAT_DATABASE, uat: true });
}

export function requireEnkyronUatCommand(target, command) {
  if (target.uat && target.database === ENKYRON_ENK05_UAT_DATABASE) {
    if (target.marker !== ENKYRON_ENK05_UAT_MARKER ||
        !ENK05_COMMANDS.has(command)) {
      throw new Error('ENKYRON ENK-05 UAT blocks operations outside synthetic Service Desk acceptance');
    }
    return;
  }
  if (target.uat && !UAT_COMMANDS.has(command)) {
    throw new Error('ENKYRON UAT blocks operations outside Company 360 synthetic acceptance');
  }
}

// ENK-04: a synthetic commercial edit may touch only a reviewed company-linked
// opportunity. This supplements backend workspace, association and revision checks.
export function requireEnkyronUatPayload(target, command, payload) {
  // ENK-05 controls operate only through their existing backend validators,
  // local-operator checks and explicit human review. No mail or assessment IPC.
  if (target.uat && target.database === ENKYRON_ENK05_UAT_DATABASE) {
    if (target.marker !== ENKYRON_ENK05_UAT_MARKER ||
        !ENK05_COMMANDS.has(command)) {
      throw new Error('ENKYRON ENK-05 UAT operation denied');
    }
    return;
  }
  if (target.uat && command === 'crm-update-opportunity' &&
      (payload?.confirmed !== true || typeof payload?.company_id !== 'string')) {
    throw new Error('ENKYRON UAT company opportunity update requires explicit reviewed company');
  }
  // ENK-04 activity UAT is restricted to an explicitly reviewed company-owned
  // local note. A note attached directly to an opportunity remains blocked in
  // this slice; normal production behavior is unchanged. No external sends.
  if (target.uat && command === 'crm-record-activity' &&
      (payload?.reviewed !== true ||
       typeof payload?.company_id !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.company_id) ||
       payload?.opportunity_id != null)) {
    throw new Error('ENKYRON UAT activity requires reviewed company-only note');
  }
  // ENK-04: synthetic UAT is a single company-level documentary review.
  // No person/contact review, automatic opportunity conversion, outreach
  // or proposal is permitted by this narrowly scoped qualification gate.
  if (target.uat && command === 'crm-record-qualification' &&
      (payload?.confirmed !== true ||
       typeof payload?.company_id !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.company_id) ||
       payload?.contact_id != null ||
       payload?.fit_status !== 'potential_fit' ||
       payload?.priority !== 'normal')) {
    throw new Error('ENKYRON UAT qualification requires reviewed company-level potential fit');
  }
  // Only an explicitly priced/reviewed company-owned *unsent* draft may be
  // created on the synthetic UAT database; legacy proposal writes stay denied.
  if (target.uat && command === 'crm-company-proposal-create' &&
      (payload?.confirmed !== true ||
       typeof payload?.company_id !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.company_id) ||
       typeof payload?.qualification_id !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.qualification_id) ||
       !Number.isSafeInteger(payload?.expected_opportunity_version) ||
       payload.expected_opportunity_version < 1 ||
       !Number.isSafeInteger(payload?.amount_minor) ||
       payload.amount_minor < 1)) {
    throw new Error('ENKYRON UAT internal draft requires reviewed company, qualification and explicit price');
  }
  // The one-off ENK-04 revision-2 UAT write can ONLY change scope of the
  // already recorded synthetic unsent GBP 1.00 company draft. All general
  // legacy draft update commands remain forbidden by the UAT allowlist.
  if (target.uat && command === 'crm-company-proposal-revise' &&
      (payload?.confirmed !== true ||
       payload?.company_id !== '0e5993e3-be9a-4837-9350-989079c2cc2f' ||
       payload?.opportunity_id !== '17d0d77c-3052-40e3-a38d-33fd4867e5d4' ||
       payload?.proposal_id !== 'd35d86b8-b16f-41c8-940d-f8e7c1dc1db8' ||
       payload?.expected_revision !== 1 ||
       typeof payload?.scope_text !== 'string' ||
       /copier le texte/i.test(payload.scope_text) ||
       typeof payload?.review_note !== 'string' ||
       payload.review_note.trim().length < 30)) {
    throw new Error('ENKYRON UAT revision is limited to exact reviewed synthetic draft R1 to R2');
  }
}

export async function verifyEnkyronUatDatabase(pool, target) {
  if (!target.uat) return;
  // The marker must be created in a separately provisioned, synthetic-only
  // database. The check runs before ANY CRM business operation.
  const result = await pool.query(
    'SELECT current_database() AS database, EXISTS(' +
    'SELECT 1 FROM public.enkyron_uat_guard WHERE marker = $1) AS verified',
    [target.database === ENKYRON_ENK05_UAT_DATABASE
      ? target.marker : ENKYRON_UAT_MARKER]
  );
  if (result.rows?.length !== 1
      || result.rows[0].database !== target.database
      || result.rows[0].verified !== true) {
    throw new Error('ENKYRON UAT database identity/marker not verified');
  }
}
