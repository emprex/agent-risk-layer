// ENK-03 synthetic UAT database routing. This is an accidental-write
// interlock, NOT an authentication or multi-user authorization mechanism.
// Normal operator behaviour (no UAT variables) remains unchanged.
export const ENKYRON_UAT_MARKER = 'ENK03_SYNTHETIC_ONLY';

const DATABASE_PREFIX = /^enkyron_uat_[a-z0-9_]{1,40}$/;
const UAT_COMMANDS = new Set([
  'tickets', 'crm-sales-overview', 'crm-sales-pipeline',
  'crm-companies', 'crm-contacts',
  'crm-company-duplicates', 'crm-contact-duplicates',
  'crm-create-company', 'crm-create-contact',
  'crm-edit-company', 'crm-edit-contact',
  'crm-company-dossier', 'crm-company-history', 'crm-company-direct-opportunity-create',
  'crm-opportunities', 'crm-activity-timeline', 'crm-update-opportunity',
  'crm-company-followups',
  'crm-company-followups-upcoming', 'crm-company-followup-create',
  'crm-company-followup-update',
]);

export function resolveEnkyronDatabase(env = process.env) {
  const hasName = Object.hasOwn(env, 'ENKYRON_UAT_DATABASE');
  const hasGate = Object.hasOwn(env, 'ENKYRON_UAT_GUARD');
  if (!hasName && !hasGate) {
    return Object.freeze({ database: 'arl_local', uat: false });
  }
  if (env.ENKYRON_UAT_GUARD !== ENKYRON_UAT_MARKER
      || !DATABASE_PREFIX.test(env.ENKYRON_UAT_DATABASE || '')) {
    throw new Error('ENKYRON UAT requires a synthetic-only acknowledgement and an enkyron_uat_ database');
  }
  return Object.freeze({ database: env.ENKYRON_UAT_DATABASE, uat: true });
}

export function requireEnkyronUatCommand(target, command) {
  if (target.uat && !UAT_COMMANDS.has(command)) {
    throw new Error('ENKYRON UAT blocks operations outside Company 360 synthetic acceptance');
  }
}

// ENK-04: a synthetic commercial edit may touch only a reviewed company-linked
// opportunity. This supplements backend workspace, association and revision checks.
export function requireEnkyronUatPayload(target, command, payload) {
  if (target.uat && command === 'crm-update-opportunity' &&
      (payload?.confirmed !== true || typeof payload?.company_id !== 'string')) {
    throw new Error('ENKYRON UAT company opportunity update requires explicit reviewed company');
  }
}

export async function verifyEnkyronUatDatabase(pool, target) {
  if (!target.uat) return;
  // The marker must be created in a separately provisioned, synthetic-only
  // database. The check runs before ANY CRM business operation.
  const result = await pool.query(
    'SELECT current_database() AS database, EXISTS(' +
    'SELECT 1 FROM public.enkyron_uat_guard WHERE marker = $1) AS verified',
    [ENKYRON_UAT_MARKER]
  );
  if (result.rows?.length !== 1
      || result.rows[0].database !== target.database
      || result.rows[0].verified !== true) {
    throw new Error('ENKYRON UAT database identity/marker not verified');
  }
}
