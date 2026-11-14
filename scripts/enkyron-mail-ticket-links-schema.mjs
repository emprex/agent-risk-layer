#!/usr/bin/env node
// E04-04B: guarded schema 116 preflight/apply for local, owner-controlled ENKYRON.
// NEVER run on app startup. On the real database, --apply requires a separate
// explicit human approval, the exact migration checksum and verified backup.
// No generic database URL, arbitrary role or --force/--reset option exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

export const VERSION='116_enkyron_mail_ticket_links.sql';
export const PREREQUISITES=[
  '110_enkyron_mail_workspace.sql',
  '112_enkyron_local_mail_calendar.sql',
  '113_enkyron_mail_content_archive.sql'
];
const SOCKET='/var/run/postgresql';
const DATABASE='arl_local';
const SCRIPT=path.basename(fileURLToPath(import.meta.url));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha256=contents=>crypto.createHash('sha256').update(contents).digest('hex');

export function parseArgs(args,digest){
  if(args.length===1&&args[0]==='--check')return {mode:'check'};
  const expected=['--apply','--confirm='+VERSION,'--sha256='+digest];
  if(args.length===3&&args.every((value,index)=>value===expected[index]))
    return {mode:'apply'};
  throw Error('Use: node scripts/'+SCRIPT+' --check\n'+
    'To apply ONLY after explicit owner approval: node scripts/'+SCRIPT+' '+
    expected.join(' ')+'\n'+
    'No migration, backup, or database connection was attempted.');
}

export function assessMigrationRows(rows,localChecksums){
  if(!Array.isArray(rows))throw Error('Cannot verify recorded migrations');
  const known=new Map();
  for(const item of rows){
    if(!item||typeof item.version!=='string'||typeof item.checksum!=='string'
       ||known.has(item.version))throw Error('Invalid or duplicated migration ledger');
    known.set(item.version,item.checksum);
  }
  for(const version of PREREQUISITES){
    if(!known.has(version))throw Error('Mail prerequisite schema missing: '+version);
    if(known.get(version)!==localChecksums[version])
      throw Error('Historical Mail schema checksum drift: '+version);
  }
  if(known.has(VERSION)){
    if(known.get(VERSION)!==localChecksums[VERSION])
      throw Error('Mail schema 116 checksum drift: stop and investigate');
    return 'APPLIED';
  }
  return 'READY';
}

async function inspectDatabase(client,actor,localChecksums){
  const id=(await client.query(
    'SELECT current_database() AS db,current_user AS actor'
  )).rows[0];
  if(id?.db!==DATABASE||id?.actor!==actor)
    throw Error('Refusing unexpected database or PostgreSQL user');
  const versions=[...PREREQUISITES,VERSION];
  const ledger=(await client.query(
    'SELECT version,checksum FROM schema_migrations '+
    'WHERE version=ANY($1::text[])',[versions])).rows;
  const state=assessMigrationRows(ledger,localChecksums);
  const objects=(await client.query(
    "SELECT to_regclass('public.enkyron_mail_local_threads') AS threads,"+
    "to_regclass('public.enkyron_local_mail_access') AS access,"+
    "to_regclass('public.arl_workbench_tickets') AS tickets,"+
    "to_regclass('public.enkyron_mail_ticket_links') AS links,"+
    "to_regprocedure('public.enkyron_crm_events_immutable()') AS immutable"
  )).rows[0];
  if(!objects?.threads||!objects.access||!objects.tickets||!objects.immutable)
    throw Error('Required Mail/Ticket tables or immutability trigger function missing');
  if(state==='READY'&&objects.links)
    throw Error('Untracked Mail-ticket table already exists; refuse to overwrite');
  if(state==='APPLIED'&&!objects.links)
    throw Error('Migration recorded but Mail-ticket table missing; investigate');
  return state;
}

async function verifiedBackup(actor){
  const dir=path.join(os.homedir(),'.local','share','enkyron','backups');
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const st=await fs.lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
    ||(st.mode&0o077)!==0)throw Error('Unsafe ENKYRON backup directory');
  const unique=await fs.mkdtemp(path.join(dir,'before-mail-116-'));
  await fs.chmod(unique,0o700);
  const backup=path.join(unique,'arl_local.dump');
  const dump=spawnSync('pg_dump',['--format=custom','--no-password',
    '--host='+SOCKET,'--username='+actor,'--dbname='+DATABASE,'--file='+backup],
    {timeout:180000,encoding:'utf8'});
  if(dump.error||dump.status!==0)
    throw Error('PostgreSQL backup failed; migration not attempted');
  await fs.chmod(backup,0o600);
  const meta=await fs.lstat(backup);
  if(!meta.isFile()||meta.isSymbolicLink()||meta.size<1024)
    throw Error('Backup is not a verified nonempty regular file');
  const restored=spawnSync('pg_restore',['--list',backup],
    {timeout:30000,encoding:'utf8'});
  if(restored.error||restored.status!==0||!restored.stdout.includes('TOC Entries'))
    throw Error('Backup inspection failed; migration not attempted');
  return backup;
}

export async function run(args=process.argv.slice(2)){
  const actor=os.userInfo().username;
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid local PostgreSQL operator');
  const sqlFiles=[...PREREQUISITES,VERSION];
  const sqls=Object.fromEntries(await Promise.all(sqlFiles.map(async version=>
    [version,await fs.readFile(path.join(root,'migrations',version),'utf8')]
  )));
  const checksums=Object.fromEntries(sqlFiles.map(version=>
    [version,sha256(sqls[version])]
  ));
  const {mode}=parseArgs(args,checksums[VERSION]); // reject before touching the DB
  const client=new pg.Client({host:SOCKET,database:DATABASE,user:actor,
    connectionTimeoutMillis:5000});
  try{
    await client.connect();
    const state=await inspectDatabase(client,actor,checksums);
    if(mode==='check'){
      console.log('ENKYRON Mail-ticket schema 116:',state);
      console.log('Migration SHA256:',checksums[VERSION]);
      console.log('No database changes or backup performed.');
      return;
    }
    if(state==='APPLIED'){
      console.log('Mail-ticket schema already verified; no changes.');
      return;
    }
    // Never execute DDL until pg_dump is complete and pg_restore --list succeeded.
    const backup=await verifiedBackup(actor);
    await client.query('BEGIN');
    try{
      await client.query("SET LOCAL lock_timeout='5000ms'");
      await client.query("SET LOCAL statement_timeout='30000ms'");
      await client.query('SELECT pg_advisory_xact_lock(814720271)');
      const still=await inspectDatabase(client,actor,checksums);
      if(still!=='READY')throw Error('Schema changed while backup was taken; abort');
      await client.query(sqls[VERSION]);
      await client.query(
        'INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
        [VERSION,checksums[VERSION]]);
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }
    console.log('Mail-ticket schema 116 installed, with recorded checksum.');
    console.log('Verified pre-migration backup:',backup);
    console.log('No existing messages, ticket records or provider folders moved.');
  }finally{
    await client.end().catch(()=>{});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  run().catch(error=>{
    console.error('ENKYRON Mail-ticket schema setup:',error.message);
    process.exitCode=1;
  });
}
