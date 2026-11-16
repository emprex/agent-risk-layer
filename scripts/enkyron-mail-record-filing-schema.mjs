#!/usr/bin/env node
// Guarded ENKYRON local Mail filing upgrade. No automatic migration on app launch.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const mode=process.argv[2],version='116_enkyron_mail_record_filing.sql';
if(!['--check','--apply'].includes(mode)||process.argv.length!==3)
  throw Error('Usage: node scripts/enkyron-mail-record-filing-schema.mjs --check | --apply');
const actor=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))throw Error('Invalid local operator');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=await fs.readFile(path.join(root,'migrations',version),'utf8');
const digest=crypto.createHash('sha256').update(sql).digest('hex');
const client=new pg.Client({host:'/var/run/postgresql',database:'arl_local',
  user:actor,connectionTimeoutMillis:5000});
try{
  await client.connect();
  const identity=(await client.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  if(identity.db!=='arl_local'||identity.actor!==actor)throw Error('Unexpected local database identity');
  const keys=['070_enkyron_crm_mail_drafts.sql','112_enkyron_local_mail_calendar.sql',version];
  const applied=(await client.query('SELECT version,checksum FROM schema_migrations WHERE version=ANY($1::text[])',[keys])).rows;
  for(const previous of keys.slice(0,2)){
    const row=applied.find(x=>x.version===previous);
    if(!row)throw Error('Required migration missing: '+previous);
    const prior=await fs.readFile(path.join(root,'migrations',previous),'utf8');
    if(crypto.createHash('sha256').update(prior).digest('hex')!==row.checksum)
      throw Error('Historic migration checksum mismatch: '+previous);
  }
  const state=applied.find(x=>x.version===version);
  if(state&&state.checksum!==digest)throw Error('Local filing migration checksum mismatch');
  if(mode==='--check'){
    console.log(version,state?'APPLIED':'NOT APPLIED');
  }else if(state){
    console.log('Already applied, no database changes.');
  }else{
    const dir=path.join(os.homedir(),'.local','share','enkyron','backups');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const stat=await fs.lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
        (stat.mode&0o077)!==0)throw Error('Unsafe backup directory');
    const destination=path.join(dir,'arl_local-before-mail-116-'+
      new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
    const backup=spawnSync('pg_dump',['--format=custom','--no-password',
      '--host=/var/run/postgresql','--username='+actor,'--dbname=arl_local',
      '--file='+destination],{timeout:180000,encoding:'utf8'});
    if(backup.status!==0)throw Error('pg_dump failed; no schema changed');
    await fs.chmod(destination,0o600);
    const verify=spawnSync('pg_restore',['--list',destination],{timeout:30000,encoding:'utf8'});
    if(verify.status!==0)throw Error('Backup validation failed; no schema changed');
    await client.query('BEGIN');
    try{
      await client.query('SELECT pg_advisory_xact_lock(814720271)');
      const fresh=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version])).rows[0];
      if(fresh)throw Error('Migration concurrently applied; review before retry');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,digest]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
    console.log('Local filing schema applied. No mail moved or deleted.');
    console.log('Verified backup:',destination);
  }
}catch(e){console.error('ENKYRON local filing:',e.message);process.exitCode=1;}
finally{await client.end().catch(()=>{});}
