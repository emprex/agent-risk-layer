#!/usr/bin/env node
// ENK-05 UAT-04 preflight — READ ONLY. No bootstrap, SQL DDL or writes.
// Intended for the explicitly provisioned, dedicated synthetic database only.
import os from 'node:os';
import pg from 'pg';
import {
  ENKYRON_ENK05_UAT_DATABASE as DB,
  ENKYRON_ENK05_UAT_MARKER as MARKER,
  resolveEnkyronDatabase,
  verifyEnkyronUatDatabase
} from '../desktop/enkyron-uat-database.mjs';

// Only the minimum tables required for a native CRM→ticket→closure UAT.
// Further functional schema preconditions remain the responsibility of UAT.
export const REQUIRED_RELATIONS=Object.freeze([
  'public.arl_workbench_tickets',
  'public.arl_workbench_ticket_events',
  'public.enkyron_ticket_triage_reviews',
  'public.enkyron_ticket_action_versions',
  'public.enkyron_crm_companies'
]);

export function requireEnk05PreflightIdentity(target, row) {
  if(target?.uat!==true || target.database!==DB || target.marker!==MARKER)
    throw Error('Refusing UAT-04 preflight: wrong target/guard');
  if(row?.database!==DB || row.role!==os.userInfo().username ||
     row.owner!==row.role || row.read_only!=='on')
    throw Error('Refusing UAT-04 preflight: database, owner or read-only session mismatch');
}

export async function inspectEnk05Preflight(pool,target) {
  if(target?.uat!==true || target.database!==DB || target.marker!==MARKER)
    throw Error('Refusing UAT-04 preflight: wrong target/guard');
  // Independently verify both name and marker. Never log account/client rows.
  await verifyEnkyronUatDatabase(pool,target);
  const result=await pool.query(
    'SELECT current_database() AS database,current_user AS role,'+
    'pg_get_userbyid(datdba) AS owner,'+
    'current_setting(\'transaction_read_only\') AS read_only '+
    'FROM pg_database WHERE datname=current_database()'
  );
  if(result.rows?.length!==1)
    throw Error('Refusing UAT-04 preflight: missing database identity');
  requireEnk05PreflightIdentity(target,result.rows[0]);
  const relations=await pool.query(
    'SELECT identifier,to_regclass(identifier) IS NOT NULL AS present '+
    'FROM unnest($1::text[]) AS identifier',
    [REQUIRED_RELATIONS]
  );
  const observed=new Map((relations.rows||[]).map(r=>[r.identifier,r.present]));
  const missing=REQUIRED_RELATIONS.filter(x=>observed.get(x)!==true);
  if(missing.length)throw Error(
    'Refusing UAT-04 preflight: missing required tables: '+missing.join(', ')
  );
  return {database:DB,synthetic_guard:'verified',read_only:true,
    required_relations:REQUIRED_RELATIONS.length,
    note:'Preflight only. No database changes. Human UAT-04 NOT_RUN.'};
}

export async function main() {
  const target=resolveEnkyronDatabase();
  if(target.database!==DB || target.uat!==true || target.marker!==MARKER)
    throw Error('ENK-05 preflight requires exact synthetic-only environment');
  const pool=new pg.Pool({
    host:'/var/run/postgresql',database:DB,
    user:os.userInfo().username,max:1,connectionTimeoutMillis:5000,
    options:'-c default_transaction_read_only=on -c statement_timeout=5000'
  });
  try {console.log(JSON.stringify(await inspectEnk05Preflight(pool,target),null,2));}
  finally {await pool.end();}
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  if(process.argv.length!==2) {
    console.error('ENK-05 UAT preflight accepts no arguments');
    process.exitCode=2;
  } else {
    main().catch(e=>{
      console.error('ENK-05 UAT preflight refused: '+String(e?.message||'unknown error'));
      process.exitCode=1;
    });
  }
}
