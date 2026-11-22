#!/usr/bin/env node
// ENK-06 read-only, guarded preflight. No migration, seeding, client access,
// network provider requests, or modification of arl_local.
import os from 'node:os';
import pg from 'pg';
import {resolveEnkyronDatabase,verifyEnkyronUatDatabase,
  ENKYRON_ENK06_UAT_DATABASE,ENKYRON_ENK06_UAT_MARKER}
  from '../desktop/enkyron-uat-database.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;
export const REQUIRED_RELATIONS=Object.freeze([
  'public.enkyron_crm_companies',
  'public.enkyron_crm_effective_ticket_links',
  'public.arl_workbench_tickets',
  'public.enkyron_local_mail_access',
  'public.enkyron_mail_local_threads',
  'public.enkyron_mail_local_messages',
  'public.enkyron_mail_attachment_quarantine',
  'public.enkyron_mail_ticket_links',
  'public.enkyron_mail_document_dossier_links'
]);
export function requireEnk06PreflightIdentity(target,row){
  if(target?.uat!==true ||target.database!==DB ||
      target.marker!==ENKYRON_ENK06_UAT_MARKER ||
      row?.database!==DB ||row.role!==os.userInfo().username ||
      row.owner!==row.role ||row.read_only!=='on' ||
      row.port!=='5432')
    throw Error('Refusing ENK-06 preflight: target, owner, port or read-only session mismatch');
}
export async function inspectEnk06Preflight(pool,target){
  if(target?.database!==DB||target.uat!==true||
      target.marker!==ENKYRON_ENK06_UAT_MARKER)
    throw Error('Refusing ENK-06 preflight: wrong synthetic target');
  await verifyEnkyronUatDatabase(pool,target);
  const identity=(await pool.query(
    "SELECT current_database() AS database,current_user AS role,"+
    "pg_get_userbyid(datdba) AS owner,"+
    "current_setting('transaction_read_only') AS read_only,"+
    "current_setting('port') AS port "+
    "FROM pg_database WHERE datname=current_database()"
  )).rows[0];
  requireEnk06PreflightIdentity(target,identity);
  const found=(await pool.query(
    "SELECT identifier,to_regclass(identifier) IS NOT NULL AS present "+
    "FROM unnest($1::text[]) AS identifier",
    [REQUIRED_RELATIONS]
  )).rows;
  const present=new Map((found||[]).map(row=>[row.identifier,row.present]));
  const missing=REQUIRED_RELATIONS.filter(r=>present.get(r)!==true);
  if(missing.length)
    throw Error('Refusing ENK-06 preflight: missing schema objects: '+missing.join(', '));
  return {database:DB,synthetic_guard:'verified',read_only:true,
    checked_relations:REQUIRED_RELATIONS.length,
    note:'No database writes or provider operations; human UAT NOT_RUN'};
}
export async function main(){
  const target=resolveEnkyronDatabase();
  if(target.database!==DB||target.uat!==true||
      target.marker!==ENKYRON_ENK06_UAT_MARKER)
    throw Error('Refusing ENK-06 preflight: exact target and marker required');
  const pool=new pg.Pool({host:'/var/run/postgresql',port:5432,
    database:DB,user:os.userInfo().username,max:1,
    connectionTimeoutMillis:5000,
    options:'-c default_transaction_read_only=on -c statement_timeout=8000'});
  try{console.log(JSON.stringify(await inspectEnk06Preflight(pool,target),null,2));}
  finally{await pool.end();}
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==2){
    console.error('ENK-06 preflight takes no command-line arguments');
    process.exitCode=2;
  }else main().catch(error=>{
    console.error('ENK-06 preflight refused: '+String(error?.message||'unknown'));
    process.exitCode=1;
  });
}
