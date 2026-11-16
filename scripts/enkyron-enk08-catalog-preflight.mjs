#!/usr/bin/env node
// ENK-08 catalog readiness audit for arl_local. READ ONLY. Never fixes or runs migrations.
// Explicit local peer socket, exact DB identity, read-only transaction, no business rows.
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {
  readMigrationManifest, readAppliedPsaSources, auditMigrationContinuity
} from './enkyron-business-migration-preflight.mjs';

const THIS = fileURLToPath(import.meta.url);
const REQUIRED = Object.freeze({
  enkyron_crm_companies: Object.freeze({
    id: 'text', workspace_key: 'text', name: 'text',
  }),
  enkyron_crm_opportunities: Object.freeze({
    id: 'text', workspace_key: 'text', company_id: 'text',
  }),
});
const PROPOSED = Object.freeze([
  'enkyron_psa_missions',
  'enkyron_psa_mission_events',
  'enkyron_psa_work_items',
  'enkyron_psa_work_item_events',
  'enkyron_psa_time_entries',
  'enkyron_psa_time_events',
]);

/** Pure catalog review; never treats a clean catalog as release authorization. */
export function reviewEnk08Catalog(columns, tableNames, constraints, functions) {
  if (![columns,tableNames,constraints,functions].every(Array.isArray))
    throw new Error('STOP: invalid catalog data');
  const cols = new Map();
  for (const row of columns) {
    if (!row || typeof row.table_name !== 'string'
      || typeof row.column_name !== 'string'
      || typeof row.data_type !== 'string')
      throw new Error('STOP: malformed catalog column');
    const key = row.table_name + '.' + row.column_name;
    if (cols.has(key)) throw new Error('STOP: duplicate catalog column');
    cols.set(key, row.data_type);
  }
  const tables = new Set(tableNames);
  const issues = [];
  for (const [table, expected] of Object.entries(REQUIRED)) {
    if (!tables.has(table)) issues.push('missing CRM table: ' + table);
    for (const [column, kind] of Object.entries(expected)) {
      const actual = cols.get(table + '.' + column);
      if (actual !== kind) issues.push('CRM column/type mismatch: ' + table + '.' + column);
    }
  }
  const existingDraftTables = PROPOSED.filter(name => tables.has(name));
  for (const name of existingDraftTables) issues.push('unexpected PSA table already present: ' + name);

  // Migration 065's (workspace_key,id) constraint is needed for the 118 FK.
  const companyUnique = constraints.some(row =>
    row && row.table_name === 'enkyron_crm_companies'
    && row.constraint_type === 'u'
    && /^UNIQUE\s*\(\s*workspace_key\s*,\s*id\s*\)$/i.test(row.definition || '')
  );
  if (!companyUnique) issues.push('CRM company workspace/id uniqueness missing');

  // Migration 094's company association is required for optional 118 links.
  const opportunityFk = constraints.some(row =>
    row && row.table_name === 'enkyron_crm_opportunities'
    && row.constraint_type === 'f'
    && /^FOREIGN KEY\s*\(\s*workspace_key\s*,\s*company_id\s*\)\s*REFERENCES\s+enkyron_crm_companies\s*\(\s*workspace_key\s*,\s*id\s*\)/i
      .test(row.definition || '')
  );
  if (!opportunityFk) issues.push('CRM opportunity-to-company scoped FK missing');

  const immutableAuditFn = functions.some(row =>
    row && row.function_name === 'enkyron_crm_events_immutable'
    && row.result_type === 'trigger'
  );
  if (!immutableAuditFn) issues.push('CRM immutable audit trigger function missing');

  return {
    crm_catalog_compatible_for_draft_review: issues.length === 0,
    issues,
    existing_psa_tables: existingDraftTables,
    inspected_only_schema: 'public',
    customer_records_read: false,
    migration_executed: false,
    release_approved: false,
  };
}

/**
 * DB identity and read-only transaction checked before schema inspection.
 * The source manifest is read from the current checkout; don't repair drift.
 */
export async function auditEnk08ProductionCatalog() {
  const actor = os.userInfo().username;
  const client = new pg.Client({
    host: '/var/run/postgresql',
    port: 5432,
    database: 'arl_local',
    user: actor,
    connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000',
  });
  const sourceRows = await readMigrationManifest();
  await client.connect();
  let active = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    active = true;
    const identity = (await client.query(
      'SELECT current_database() AS database,current_user AS actor,'
      + 'current_setting($1) AS transaction_read_only',
      ['transaction_read_only']
    )).rows[0];
    if (identity?.database !== 'arl_local' || identity?.actor !== actor
      || identity?.transaction_read_only !== 'on') {
      throw new Error('STOP: wrong database/operator or non-read-only transaction');
    }
    const appliedRows = (await client.query(
      'SELECT version,checksum FROM schema_migrations ORDER BY version'
    )).rows;
    const managed = await readAppliedPsaSources(appliedRows);
    const migration = auditMigrationContinuity([...sourceRows,...managed], appliedRows);
    const tables = (await client.query(
      "SELECT c.relname AS table_name FROM pg_catalog.pg_class c "
      + "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
      + "WHERE n.nspname='public' AND c.relkind IN ('r','p') "
      + "AND (c.relname LIKE 'enkyron_crm_%' OR c.relname LIKE 'enkyron_psa_%')"
    )).rows.map(x=>x.table_name);
    const columns = (await client.query(
      "SELECT c.relname AS table_name,a.attname AS column_name,"
      + "pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type "
      + "FROM pg_catalog.pg_attribute a "
      + "JOIN pg_catalog.pg_class c ON c.oid=a.attrelid "
      + "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
      + "WHERE n.nspname='public' AND c.relname IN "
      + "('enkyron_crm_companies','enkyron_crm_opportunities') "
      + "AND a.attnum>0 AND NOT a.attisdropped"
    )).rows;
    const constraints = (await client.query(
      "SELECT c.relname AS table_name,p.contype AS constraint_type,"
      + "pg_catalog.pg_get_constraintdef(p.oid) AS definition "
      + "FROM pg_catalog.pg_constraint p "
      + "JOIN pg_catalog.pg_class c ON c.oid=p.conrelid "
      + "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
      + "WHERE n.nspname='public' "
      + "AND c.relname IN ('enkyron_crm_companies','enkyron_crm_opportunities') "
      + "AND p.contype IN ('u','f')"
    )).rows;
    const functions = (await client.query(
      "SELECT p.proname AS function_name,"
      + "pg_catalog.pg_get_function_result(p.oid) AS result_type "
      + "FROM pg_catalog.pg_proc p "
      + "JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace "
      + "WHERE n.nspname='public' AND p.proname='enkyron_crm_events_immutable'"
    )).rows;
    const catalog = reviewEnk08Catalog(columns,tables,constraints,functions);
    await client.query('COMMIT');
    active = false;
    return {
      database: identity.database, actor: identity.actor, read_only: true,
      migration,
      catalog,
      release_gate: 'STOP — history reconciliation, verified backup/restore, full-schema rehearsal, '
        + 'authenticated write policy and human acceptance required',
    };
  } finally {
    if (active) await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    console.error('Usage: node scripts/enkyron-enk08-catalog-preflight.mjs --check');
    process.exitCode = 2;
  } else {
    auditEnk08ProductionCatalog().then(result => {
      console.log(JSON.stringify(result,null,2));
      console.log('ENK-08 CATALOG PREFLIGHT: READ ONLY — RELEASE STOP');
      // Catalog compatibility alone never authorizes a migration.
      process.exitCode = 2; // The live migration/authorization gate is STOP even when catalog matches.
    }).catch(err => {
      console.error('ENK-08 CATALOG PREFLIGHT: STOP — ' + String(err?.message||err));
      process.exitCode = 2;
    });
  }
}
