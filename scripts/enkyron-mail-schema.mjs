#!/usr/bin/env node
// Explicit local mail workspace schema + owner-only mailbox grants.
// CLI only: NEVER invoked by opening ENKYRON. No credentials or emails sent.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import pg from 'pg';

const version='110_enkyron_mail_workspace.sql';
const mode=process.argv[2];
if(!['--check','--apply'].includes(mode)||process.argv.length!==3)
  throw new Error('Usage: node scripts/enkyron-mail-schema.mjs --check | --apply');
const operator=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))throw new Error('Invalid local operator');
const workspace='local:'+operator;
const sql=await fs.readFile(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),'../migrations',version
),'utf8');
const checksum=crypto.createHash('sha256').update(sql).digest('hex');
const client=new pg.Client({
  host:'/var/run/postgresql',database:'arl_local',user:operator,connectionTimeoutMillis:5000
});
try{
  await client.connect();
  const identity=(await client.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  if(identity?.db!=='arl_local'||identity.actor!==operator)
    throw new Error('Unexpected local database identity');
  const old=(await client.query(
    'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
  )).rows[0];
  if(old&&old.checksum!==checksum)throw new Error('Mail schema checksum conflict');
  const exists=await client.query(
    'SELECT EXISTS(SELECT 1 FROM enkyron_operator_personal_profiles '+
    'WHERE workspace_key=$1) AS has_profile',[workspace]
  );
  if(!exists.rows[0]?.has_profile)throw new Error('Existing local My account profile missing');
  let entries=[];
  if(old){
    entries=(await client.query(
      'SELECT mailbox_key,can_read,can_send,role FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1 ORDER BY mailbox_key',[workspace]
    )).rows;
  }
  if(mode==='--check'){
    console.log('Mail schema:',old?'APPLIED':'NOT APPLIED');
    console.log('Local mailbox grants:',entries.length===2
      &&entries.every(x=>x.can_read&&x.can_send&&x.role==='organization_owner_l5')
      ?'Direction and Support':'NOT PROVISIONED');
  }else{
    if(old&&entries.length===2){
      console.log('Mail schema and both mailbox grants already exist. Nothing changed.');
    }else{
      const folder=path.join(os.homedir(),'.local','share','enkyron','backups');
      await fs.mkdir(folder,{recursive:true,mode:0o700});
      const st=await fs.lstat(folder);
      if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
          ||(st.mode&0o077)!==0)throw new Error('Unsafe backup directory');
      const backup=path.join(folder,
        'arl_local-before-mail-110-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
      const result=spawnSync('pg_dump',[
        '--format=custom','--no-password','--host=/var/run/postgresql',
        '--username='+operator,'--dbname=arl_local','--file='+backup
      ],{timeout:180000,encoding:'utf8'});
      if(result.status!==0)throw new Error('Database backup failed; nothing changed');
      await fs.chmod(backup,0o600);
      const verified=spawnSync('pg_restore',['--list',backup],
        {timeout:30000,encoding:'utf8'});
      if(verified.status!==0)throw new Error('Backup verification failed; nothing changed');
      await client.query('BEGIN');
      try{
        await client.query('SELECT pg_advisory_xact_lock(814720270)');
        const current=(await client.query(
          'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
        )).rows[0];
        if(current&&current.checksum!==checksum)throw new Error('Concurrent migration conflict');
        if(!current){
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
            [version,checksum]
          );
        }
        // This is a LOCAL single-operator grant backed by existing My account,
        // not a remote login or a multi-user security authority.
        for(const mailbox of ['direction','support']){
          await client.query(
            'INSERT INTO enkyron_local_mail_access '+
            '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
            'VALUES($1,$2,$3,TRUE,TRUE,$4) ON CONFLICT DO NOTHING',
            [workspace,mailbox,'organization_owner_l5',operator]
          );
        }
        await client.query('COMMIT');
      }catch(e){
        await client.query('ROLLBACK').catch(()=>{});
        throw e;
      }
      console.log('Mail schema and two local mailbox grants applied.');
      console.log('Verified PostgreSQL backup:',backup);
      console.log('No account passphrase, mailbox credentials or emails changed.');
    }
  }
}catch(e){
  console.error('ENKYRON mail setup:',e.message);
  process.exitCode=1;
}finally{await client.end().catch(()=>{});}
