#!/usr/bin/env node
// Explicit, backed-up local filing schema. Never runs when ENKYRON opens.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const version='111_enkyron_mail_filing.sql',mode=process.argv[2];
if(!['--check','--apply'].includes(mode)||process.argv.length!==3)
  throw new Error('Usage: node scripts/enkyron-mail-filing-schema.mjs --check | --apply');
const actor=os.userInfo().username,workspace='local:'+actor;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))throw new Error('Invalid local operator');
const sql=await fs.readFile(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),'..','migrations',version
),'utf8');
const digest=crypto.createHash('sha256').update(sql).digest('hex');
const client=new pg.Client({host:'/var/run/postgresql',database:'arl_local',
  user:actor,connectionTimeoutMillis:5000});
try{
  await client.connect();
  const info=(await client.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  if(info.db!=='arl_local'||info.actor!==actor)
    throw new Error('Unexpected local database identity');
  const latest=(await client.query(
    "SELECT version,checksum FROM schema_migrations WHERE version IN ($1,$2)",
    ['110_enkyron_mail_workspace.sql',version]
  )).rows;
  const prior=latest.find(x=>x.version==='110_enkyron_mail_workspace.sql');
  if(!prior)throw new Error('Existing Mail schema 110 must be applied first');
  const previousSql=await fs.readFile(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),'..','migrations',
    '110_enkyron_mail_workspace.sql'),'utf8');
  const previousHash=crypto.createHash('sha256').update(previousSql).digest('hex');
  if(prior.checksum!==previousHash)throw new Error('Historical Mail checksum mismatch');
  const applied=latest.find(x=>x.version===version);
  if(applied&&applied.checksum!==digest)throw new Error('Filing schema checksum mismatch');
  if(mode==='--check'){
    const access=applied?(await client.query(
      'SELECT mailbox_key,can_manage FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1 ORDER BY mailbox_key',[workspace]
    )).rows:[];
    console.log('Filing schema:',applied?'APPLIED':'NOT APPLIED');
    console.log('Operator filing permission:',
      access.length===2&&access.every(x=>x.can_manage)?'ENABLED':'NOT ENABLED');
  }else if(applied){
    console.log('Mail filing schema already applied; no changes.');
  }else{
    const dir=path.join(os.homedir(),'.local','share','enkyron','backups');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const st=await fs.lstat(dir);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
      ||(st.mode&0o077)!==0)throw new Error('Unsafe backup directory');
    const backup=path.join(dir,'arl_local-before-mail-111-'+
      new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
    const dump=spawnSync('pg_dump',['--format=custom','--no-password',
      '--host=/var/run/postgresql','--username='+actor,
      '--dbname=arl_local','--file='+backup],{timeout:180000,encoding:'utf8'});
    if(dump.status!==0)throw new Error('Database backup failed; nothing changed');
    await fs.chmod(backup,0o600);
    const verify=spawnSync('pg_restore',['--list',backup],
      {timeout:30000,encoding:'utf8'});
    if(verify.status!==0)throw new Error('Backup verification failed; nothing changed');
    await client.query('BEGIN');
    try{
      await client.query('SELECT pg_advisory_xact_lock(814720271)');
      const current=(await client.query(
        'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
      )).rows[0];
      if(current)throw new Error('Schema concurrently applied; review state');
      await client.query(sql);
      // Only provision filing for the same explicit local owner mail grants.
      const grant=await client.query(
        'UPDATE enkyron_local_mail_access SET can_manage=TRUE '+
        "WHERE workspace_key=$1 AND role='organization_owner_l5' "+
        "AND mailbox_key IN ('direction','support')",
        [workspace]
      );
      if(grant.rowCount!==2)throw new Error('Expected two pre-existing Owner mailbox grants');
      await client.query(
        'INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
        [version,digest]
      );
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }
    console.log('Mail folder schema and Owner filing grants applied.');
    console.log('Verified backup:',backup);
    console.log('No messages moved or deleted by this migration.');
  }
}catch(error){
  console.error('ENKYRON Mail filing setup:',error.message);
  process.exitCode=1;
}finally{await client.end().catch(()=>{});}
