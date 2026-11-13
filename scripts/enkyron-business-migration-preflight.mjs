#!/usr/bin/env node
// ENKYRON business integration preflight: READ ONLY, never migrates or repairs.
// Uses the local Debian peer operator and the existing arl_local DB only.
// No customer records, credentials or SQL contents are printed.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const THIS = fileURLToPath(import.meta.url);
const MIGRATION_DIR = path.resolve(path.dirname(THIS),'..','migrations');
const MIGRATION_NAME = /^\d{3}_[a-z0-9_-]+\.sql$/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readMigrationManifest(dir=MIGRATION_DIR) {
  const names = (await readdir(dir)).filter(n=>MIGRATION_NAME.test(n)).sort();
  return Promise.all(names.map(async version=>({
    version, checksum:digest(await readFile(path.join(dir,version)))
  })));
}

export function auditMigrationContinuity(sourceRows, appliedRows) {
  if (!Array.isArray(sourceRows)||!Array.isArray(appliedRows))
    throw new Error('Migration manifests must be arrays');
  const source = new Map();
  const applied = new Map();
  for (const row of sourceRows) {
    if (!row||typeof row.version!=='string'||
        !MIGRATION_NAME.test(row.version)||
        !/^[0-9a-f]{64}$/.test(row.checksum||'')||
        source.has(row.version))
      throw new Error('Invalid or duplicate source migration identity');
    source.set(row.version,row.checksum);
  }
  for (const row of appliedRows) {
    if (!row||typeof row.version!=='string'||
        !MIGRATION_NAME.test(row.version)||
        !/^[0-9a-f]{64}$/.test(row.checksum||'')||
        applied.has(row.version))
      throw new Error('Invalid or duplicate applied migration identity');
    applied.set(row.version,row.checksum);
  }
  const missing_source = [...applied.keys()].filter(n=>!source.has(n)).sort();
  const checksum_mismatch = [...applied.keys()].filter(n=>
    source.has(n)&&source.get(n)!==applied.get(n)
  ).sort();
  const pending = [...source.keys()].filter(n=>!applied.has(n)).sort();
  // Numeric prefixes are advisory only. Migration IDs are FULL FILENAMES.
  const byPrefix = new Map();
  for(const n of [...new Set([...source.keys(),...applied.keys()])]) {
    const key=n.slice(0,3);
    const v=byPrefix.get(key)||[];
    v.push(n);
    byPrefix.set(key,v);
  }
  const shared_number = [...byPrefix.entries()]
    .filter(([,v])=>v.length>1)
    .map(([number,names])=>({number,names:names.sort()}))
    .sort((a,b)=>a.number.localeCompare(b.number));
  return {
    source_files:source.size,
    applied_records:applied.size,
    missing_source,
    checksum_mismatch,
    pending,
    shared_number,
    ready_for_no_change:missing_source.length===0 &&
      checksum_mismatch.length===0 && pending.length===0
  };
}

export async function preflightBusinessDatabase(dir=MIGRATION_DIR) {
  // No DATABASE_URL, PGHOST or alternate DB accepted; prevents wrong-target use.
  const user=os.userInfo().username;
  const client=new pg.Client({
    host:'/var/run/postgresql',
    database:'arl_local',
    user,
    connectionTimeoutMillis:5000,
    options:'-c default_transaction_read_only=on -c statement_timeout=5000'
  });
  const sourceRows=await readMigrationManifest(dir);
  await client.connect();
  let started=false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started=true;
    const identity=(await client.query(
      'SELECT current_database() AS database,current_user AS actor'
    )).rows[0];
    if(identity?.database!=='arl_local'||identity?.actor!==user)
      throw new Error('STOP: unexpected database or local operator');
    const appliedRows=(await client.query(
      'SELECT version,checksum FROM schema_migrations ORDER BY version'
    )).rows;
    const report=auditMigrationContinuity(sourceRows,appliedRows);
    await client.query('COMMIT');
    started=false;
    return {database:'arl_local',actor:user,...report};
  } finally {
    if(started)await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===THIS) {
  if(process.argv.length!==3||process.argv[2]!=='--check') {
    console.error('Usage: node scripts/enkyron-business-migration-preflight.mjs --check');
    process.exitCode=2;
  } else {
    preflightBusinessDatabase().then(report=>{
      // Names / SHA mismatch categories only. Do not print customer records.
      console.log(JSON.stringify(report,null,2));
      console.log(report.ready_for_no_change
        ? 'READ-ONLY PREFLIGHT: NO PENDING/UNKNOWN MIGRATIONS'
        : 'READ-ONLY PREFLIGHT: STOP — REVIEW BEFORE ANY MIGRATION');
      // Pending versions are not a reason to apply them automatically.
      if(!report.ready_for_no_change)process.exitCode=2;
    }).catch(e=>{
      console.error('READ-ONLY PREFLIGHT: STOP — '+String(e?.message||e));
      process.exitCode=2;
    });
  }
}
