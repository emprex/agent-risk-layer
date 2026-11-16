#!/usr/bin/env node
// Explicit migration for local ENKYRON mail filing. Never run from the GUI.
// --check is read-only. --apply takes an owner-only PostgreSQL backup first.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const version='120_enkyron_mail_folder_triage.sql';
const mode=process.argv[2];
if(!['--check','--apply'].includes(mode)||process.argv.length!==3)
  throw Error('Usage: node scripts/enkyron-mail-folder-triage-schema.mjs --check | --apply');
const operator=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))throw Error('Invalid local operator');
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','migrations');
const sql=await fs.readFile(path.join(dir,version),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const checksum=hash(sql);
const client=new pg.Client({host:'/var/run/postgresql',database:'arl_local',
  user:operator,connectionTimeoutMillis:5000});
await client.connect();
try{
  const who=(await client.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  if(who.db!=='arl_local'||who.actor!==operator)
    throw Error('Refusing unknown database or operator identity');
  for(const name of ['070_enkyron_crm_mail_drafts.sql','112_enkyron_local_mail_calendar.sql']){
    const prev=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[name])).rows[0];
    if(!prev)throw Error('Missing prerequisite: '+name);
    if(prev.checksum!==hash(await fs.readFile(path.join(dir,name),'utf8')))
      throw Error('Historical migration checksum mismatch: '+name);
  }
  const prior=(await client.query(
    'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
  )).rows[0];
  if(prior && prior.checksum!==checksum)throw Error('Mail folder migration checksum mismatch');
  if(mode==='--check'){
    console.log('Mail folder triage schema:',prior?'APPLIED':'NOT APPLIED');
  } else if(prior){
    console.log('Mail folder triage already applied, no changes');
  } else {
    const backupDir=path.join(os.homedir(),'.local','share','enkyron','backups');
    await fs.mkdir(backupDir,{recursive:true,mode:0o700});
    const st=await fs.lstat(backupDir);
    if(st.isSymbolicLink()||!st.isDirectory()||st.uid!==process.getuid()||
      (st.mode&0o077)!==0)throw Error('Unsafe backup directory');
    const backup=path.join(backupDir,'arl_local-before-mail-120-'+
      new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
    const dump=spawnSync('pg_dump',['--format=custom','--no-password',
      '--host=/var/run/postgresql','--username='+operator,
      '--dbname=arl_local','--file='+backup],{timeout:180000,encoding:'utf8'});
    if(dump.status!==0)throw Error('Backup failed, migration not applied: '+String(dump.stderr||''));
    await fs.chmod(backup,0o600);
    const verified=spawnSync('pg_restore',['--list',backup],{timeout:30000,encoding:'utf8'});
    if(verified.status!==0)throw Error('Backup verification failed; no migration applied');
    console.log('Verified pre-migration backup:',backup);
    await client.query('BEGIN');
    try{
      await client.query('SELECT pg_advisory_xact_lock(814720120)');
      const duplicate=(await client.query(
        'SELECT checksum FROM schema_migrations WHERE version=$1 FOR UPDATE',[version]
      )).rows[0];
      if(duplicate)throw Error('Migration concurrently applied; re-run --check');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
        [version,checksum]);
      await client.query('COMMIT');
      console.log('Mail folder triage schema APPLIED (local only)');
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  }
}finally{await client.end();}
