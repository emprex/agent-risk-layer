#!/usr/bin/env node
// ENKYRON local schema extension. Exact migration only, never initializes a DB.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root,'migrations');
const migration = '064_enkyron_ticket_assignment_archive.sql';
const mode = process.argv[2];
if (!['--check','--apply'].includes(mode) || process.argv.length!==3) {
  throw new Error('Usage: node scripts/enkyron-client-desk-schema.mjs --check | --apply');
}
const username=os.userInfo().username;
const connection={
  host:'/var/run/postgresql',database:'arl_local',user:username,
  connectionTimeoutMillis:5000
};
const digest=sql=>crypto.createHash('sha256').update(sql).digest('hex');
const client=new pg.Client(connection);
await client.connect();
try {
  const info=(await client.query(
    'SELECT current_database() AS db,current_user AS username'
  )).rows[0];
  if(info.db!=='arl_local' || info.username!==username){
    throw new Error('Unexpected PostgreSQL database or operator');
  }
  const entries=(await fs.readdir(migrationsDir))
    .filter(n=>/^\d{3}_[a-z0-9_-]+\.sql$/i.test(n)).sort();
  if(!entries.includes(migration))throw new Error('ENKYRON schema migration missing');
  const sqlByName=new Map(await Promise.all(
    entries.map(async name=>[name, await fs.readFile(path.join(migrationsDir,name),'utf8')])
  ));
  const expectedDigest=digest(sqlByName.get(migration));
  const stored=(await client.query(
    'SELECT version,checksum FROM schema_migrations'
  )).rows;
  const previous=new Map(stored.map(r=>[r.version,r.checksum]));
  // No migration guessing: the canonical runner must already have applied
  // all historical migrations with exact, unmodified digests.
  for(const name of entries.filter(n=>n<migration)){
    if(!previous.has(name))throw new Error('Historical migration missing: '+name);
    if(previous.get(name)!==digest(sqlByName.get(name))){
      throw new Error('Historical migration checksum mismatch: '+name);
    }
  }
  const current=previous.get(migration);
  if(current && current!==expectedDigest)throw new Error('ENKYRON schema checksum mismatch');
  if(current) {
    console.log('ENKYRON schema already applied and verified; no changes.');
  } else if(mode==='--check') {
    console.log('ENKYRON schema not applied; historical migrations verified. No changes.');
  } else {
    // Retain a rollback artefact outside the repository, before changing
    // any PostgreSQL table or migration ledger record.
    const backupDir=path.join(os.homedir(),'.local','share','enkyron','backups');
    await fs.mkdir(backupDir,{recursive:true,mode:0o700});
    const backup=path.join(backupDir,
      'arl_local-before-enkyron-064-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
    const result=spawnSync('pg_dump',[
      '--format=custom','--no-password','--host=/var/run/postgresql',
      '--username='+username,'--dbname=arl_local','--file='+backup
    ],{timeout:180_000,encoding:'utf8'});
    if(result.status!==0){
      await fs.rm(backup,{force:true}).catch(()=>{});
      throw new Error('PostgreSQL backup failed. Schema unchanged.');
    }
    console.log('Local PostgreSQL backup created: '+backup);
    await client.query('BEGIN');
    try{
      await client.query('SELECT pg_advisory_xact_lock(814720260)');
      const again=(await client.query(
        'SELECT checksum FROM schema_migrations WHERE version=$1',[migration]
      )).rows[0];
      if(again) {
        if(again.checksum!==expectedDigest)throw new Error('Concurrent schema checksum mismatch');
      } else {
        await client.query(sqlByName.get(migration));
        await client.query(
          'INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)',
          [migration,expectedDigest]
        );
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }
    console.log('ENKYRON assignment/archive migration applied atomically.');
  }
}finally{await client.end();}
