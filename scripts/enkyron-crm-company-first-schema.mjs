#!/usr/bin/env node
// ENKYRON company-first journal/draft migration. Never auto-applies when launching ENKYRON.
// Only the already-established single-operator arl_local database may be changed.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const mode=process.argv[2];
if (!['--check','--apply'].includes(mode) || process.argv.length!==3) {
  throw new Error('Usage: node scripts/enkyron-crm-company-first-schema.mjs --check | --apply');
}
const version='104_enkyron_crm_company_first_journal_drafts.sql';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','migrations');
const digest=sql=>crypto.createHash('sha256').update(sql).digest('hex');
const operator=os.userInfo().username;
const client=new pg.Client({
  host:'/var/run/postgresql',database:'arl_local',user:operator,
  connectionTimeoutMillis:5000
});
await client.connect();
try{
  const info=(await client.query(
    'SELECT current_database() AS database,current_user AS actor'
  )).rows[0];
  if(info.database!=='arl_local'||info.actor!==operator) {
    throw new Error('Unexpected local PostgreSQL database or operator');
  }
  const names=(await fs.readdir(dir))
    .filter(x=>/^\d{3}_[a-z0-9_-]+\.sql$/i.test(x)).sort();
  if(!names.includes(version))throw new Error('ENKYRON migration 103 missing');
  const sqls=new Map(await Promise.all(
    names.map(async name=>[name,await fs.readFile(path.join(dir,name),'utf8')])
  ));
  const prior=(await client.query(
    'SELECT version,checksum FROM schema_migrations'
  )).rows;
  const applied=new Map(prior.map(x=>[x.version,x.checksum]));
  // All prior migration names and checksums must match the branch exactly.
  for(const name of names.filter(x=>x<version)){
    if(!applied.has(name))throw new Error('Historical migration absent: '+name);
    if(applied.get(name)!==digest(sqls.get(name))){
      throw new Error('Historical migration checksum mismatch: '+name);
    }
  }
  const expected=digest(sqls.get(version));
  const existing=applied.get(version);
  if(existing && existing!==expected)throw new Error('ENKYRON migration checksum mismatch');
  if(existing){
    console.log('ENKYRON company-first journal/draft schema 103 already applied and checksum verified. No changes.');
  }else if(mode==='--check'){
    console.log('ENKYRON company-first journal/draft schema 103 not applied. Historical migrations verified; no changes.');
  }else{
    const backupDir=path.join(os.homedir(),'.local','share','enkyron','backups');
    await fs.mkdir(backupDir,{recursive:true,mode:0o700});
    const backup=path.join(backupDir,
      'arl_local-before-enkyron-104-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
    const result=spawnSync('pg_dump',[
      '--format=custom','--no-password','--host=/var/run/postgresql',
      '--username='+operator,'--dbname=arl_local','--file='+backup
    ],{timeout:180_000,encoding:'utf8'});
    if(result.status!==0){
      await fs.rm(backup,{force:true}).catch(()=>{});
      throw new Error('Backup failed; ENKYRON schema was not changed');
    }
    await fs.chmod(backup,0o600);
    const verified=spawnSync('pg_restore',['--list',backup],{timeout:30000,encoding:'utf8'});
    if(verified.status!==0)throw new Error('Backup verification failed; no schema changes');
    console.log('Verified owner-only PostgreSQL backup: '+backup);
    await client.query('BEGIN');
    try{
      await client.query('SELECT pg_advisory_xact_lock(814720260)');
      const row=(await client.query(
        'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
      )).rows[0];
      if(row){
        if(row.checksum!==expected)throw new Error('Concurrent ENKYRON schema checksum mismatch');
      }else{
        await client.query(sqls.get(version));
        await client.query(
          'INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
          [version,expected]
        );
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }
    console.log('ENKYRON company-first journal/draft schema 103 applied. Only additive company-first journal/draft/payment records created; existing drafts, contracts and assessments remain unchanged.');
  }
}finally{await client.end();}
