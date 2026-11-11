#!/usr/bin/env node
// Delete ONLY the two specified local test company rows.
// No cascading deletes, no removed audit events, no unrelated tables changed.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';

const NAMES=Object.freeze(['ARL CRM Import Test 3d5a49b4','Test']);
const mode=process.argv[2];
if(!['--check','--remove'].includes(mode)||process.argv.length!==3){
  console.error('Usage: node scripts/enkyron-clean-test-companies.mjs --check | --remove');
  process.exit(2);
}
const operator=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))throw Error('Invalid local operator');
const scope='local:'+operator;
const db=new pg.Client({
  host:'/var/run/postgresql',database:'arl_local',user:operator,
  connectionTimeoutMillis:5000,
  options:'-c statement_timeout=20000 -c lock_timeout=5000',
});
function ident(value){
  if(typeof value!=='string'||!/^[a-z_][a-z0-9_]*$/.test(value))
    throw Error('Unexpected database identifier during dependency scan');
  return '"'+value+'"';
}
async function targetRows(client,lock=false){
  const result=await client.query(
    'SELECT id,name,source_type,relationship_state,created_at '+
    'FROM enkyron_crm_companies WHERE workspace_key=$1 AND name=ANY($2::text[]) '+
    'ORDER BY name,id'+(lock?' FOR UPDATE':''),
    [scope,NAMES]
  );
  const rows=result.rows;
  if(rows.length!==2||NAMES.some(name=>rows.filter(x=>x.name===name).length!==1)
     ||rows.some(row=>row.relationship_state!=='prospect'))
    throw Error('The two exact unique test prospect records were not found; no deletion');
  return rows;
}
async function checkDependencies(client,rows){
  const ids=rows.map(x=>x.id);
  // Installed business tables are inspected, including later migrations.
  const columns=(await client.query(
    'SELECT table_name,column_name FROM information_schema.columns '+
    "WHERE table_schema='public' AND (column_name='company_id' "+
    "OR column_name ~ '(^|_)company_id$' "+
    "OR column_name ~ '(^|_)company_ref(erence)?_id$') "+
    "AND table_name<>'enkyron_crm_companies' "+
    'ORDER BY table_name,column_name'
  )).rows;
  const references=[];
  for(const {table_name,column_name} of columns){
    const exists=(await client.query(
      'SELECT EXISTS(SELECT 1 FROM public.'+ident(table_name)+
      ' WHERE '+ident(column_name)+'::text=ANY($1::text[])) AS found',
      [ids]
    )).rows[0]?.found;
    if(exists)references.push(table_name+'.'+column_name);
  }
  const constraints=(await client.query(
    "SELECT conrelid::regclass::text AS referenced_from,confdeltype "+
    "FROM pg_constraint WHERE contype='f' "+
    "AND confrelid='public.enkyron_crm_companies'::regclass"
  )).rows;
  if(constraints.some(row=>!['a','r'].includes(row.confdeltype)))
    throw Error('Unsafe cascading foreign key exists; no deletion');
  if(references.length)throw Error(
    'Related business records exist in '+references.join(', ')+
    '; no rows deleted (review links first)'
  );
  return {columns:columns.length,constraints:constraints.length};
}
async function verifiedBackup(){
  const folder=path.join(os.homedir(),'.local','share','enkyron','backups');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const st=await fs.lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
      ||(st.mode&0o077)!==0)
    throw Error('Backup directory has unsafe permissions');
  const filename=path.join(folder,'arl_local-before-crm-test-removal-'+
    new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
  process.umask(0o077);
  const dumped=spawnSync('pg_dump',[
    '--format=custom','--no-password','--host=/var/run/postgresql',
    '--username='+operator,'--dbname=arl_local','--file='+filename,
  ],{timeout:180000,encoding:'utf8'});
  if(dumped.status!==0)throw Error('pg_dump failed; no deletion');
  await fs.chmod(filename,0o600);
  const checked=spawnSync('pg_restore',['--list',filename],
    {timeout:30000,encoding:'utf8'});
  if(checked.status!==0)throw Error('Backup verification failed; no deletion');
  return filename;
}
try{
  await db.connect();
  const identity=(await db.query(
    'SELECT current_database() AS db,current_user AS username'
  )).rows[0];
  if(identity.db!=='arl_local'||identity.username!==operator)
    throw Error('Wrong database or local user; no deletion');
  const rows=await targetRows(db);
  const deps=await checkDependencies(db,rows);
  console.log('Exact test rows:');
  for(const row of rows)console.log('  '+row.name+' · '+row.id);
  console.log('Checked '+deps.columns+' relationship columns, '+
    deps.constraints+' foreign keys.');
  if(mode==='--check'){
    console.log('Preview only. No rows changed.');
  }else{
    const backup=await verifiedBackup();
    await db.query('BEGIN');
    try{
      const current=await targetRows(db,true);
      if(JSON.stringify(current.map(x=>x.id))!==JSON.stringify(rows.map(x=>x.id)))
        throw Error('The target IDs changed during review');
      await checkDependencies(db,current);
      const deleted=await db.query(
        'DELETE FROM enkyron_crm_companies WHERE workspace_key=$1 '+
        'AND ((name=$2 AND id=$3) OR (name=$4 AND id=$5)) RETURNING id,name',
        [scope,rows[0].name,rows[0].id,rows[1].name,rows[1].id]
      );
      if(deleted.rowCount!==2)
        throw Error('Unexpected deletion count; transaction rolled back');
      await db.query('COMMIT');
      console.log('Removed exactly 2 test companies.');
      console.log('Append-only CRM audit events were preserved.');
      console.log('Verified database backup: '+backup);
    }catch(e){
      await db.query('ROLLBACK').catch(()=>{});
      throw e;
    }
  }
}catch(e){
  console.error('SAFE STOP:',e.message);
  process.exitCode=1;
}finally{
  await db.end().catch(()=>{});
}
