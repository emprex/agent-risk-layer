#!/usr/bin/env node
// Archive exactly TWO specified ENKYRON LOCAL CRM test-company records.
// This is intentionally NON-DESTRUCTIVE: relationships, contacts and audit
// history remain in PostgreSQL. No destructive SQL or FK changes.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';

const NAMES=Object.freeze(['ARL CRM Import Test 3d5a49b4','Test']);
const mode=process.argv[2];
if(!['--check','--archive'].includes(mode)||process.argv.length!==3){
  console.error('Usage: node scripts/enkyron-clean-test-companies.mjs --check | --archive');
  process.exit(2);
}
const operator=os.userInfo().username;
if(!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))
  throw Error('Invalid Linux operator');
const scope='local:'+operator;
const db=new pg.Client({
  host:'/var/run/postgresql',database:'arl_local',user:operator,
  connectionTimeoutMillis:5000,
  options:'-c statement_timeout=20000 -c lock_timeout=5000',
});

async function targetRows(client,lock=false){
  const result=await client.query(
    'SELECT id,name,source_type,relationship_state,record_version '+
    'FROM enkyron_crm_companies WHERE workspace_key=$1 AND name=ANY($2::text[]) '+
    'ORDER BY name,id'+(lock?' FOR UPDATE':''),
    [scope,NAMES]
  );
  const rows=result.rows;
  if(rows.length!==2
      ||NAMES.some(name=>rows.filter(x=>x.name===name).length!==1)
      ||rows.some(r=>!['prospect','inactive'].includes(r.relationship_state)))
    throw Error('Expected exactly two named prospect/archived test companies; no changes');
  return rows;
}
async function linkedCounts(client,rows){
  // Report links, never modify them. Names come from database metadata and
  // identifiers are strictly validated before inclusion in a SQL identifier.
  const identifiers=(await client.query(
    'SELECT table_name,column_name FROM information_schema.columns '+
    "WHERE table_schema='public' "+
    "AND (column_name='company_id' OR column_name ~ '(^|_)company_id$' "+
    "OR column_name ~ '(^|_)company_ref(erence)?_id$') "+
    "AND table_name<>'enkyron_crm_companies' "+
    'ORDER BY table_name,column_name'
  )).rows;
  const quote=x=>{
    if(typeof x!=='string'||!/^[a-z_][a-z0-9_]*$/.test(x))
      throw Error('Unexpected database identifier');
    return '"'+x+'"';
  };
  const output=[];
  for(const row of rows){
    let linked=0;
    const tables=[];
    for(const {table_name,column_name} of identifiers){
      const found=await client.query(
        'SELECT COUNT(*)::integer AS n FROM public.'+quote(table_name)+
        ' WHERE '+quote(column_name)+'::text=$1',[row.id]
      );
      const count=found.rows[0]?.n||0;
      if(count>0){linked+=count;tables.push(table_name+'.'+column_name+': '+count);}
    }
    output.push({id:row.id,name:row.name,count:linked,tables});
  }
  return output;
}
async function verifiedBackup(){
  const folder=path.join(os.homedir(),'.local','share','enkyron','backups');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const st=await fs.lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()
      ||(st.mode&0o077)!==0)
    throw Error('Backup directory has unsafe permissions');
  const filename=path.join(folder,'arl_local-before-crm-test-archive-'+
    new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
  process.umask(0o077);
  const dumped=spawnSync('pg_dump',[
    '--format=custom','--no-password','--host=/var/run/postgresql',
    '--username='+operator,'--dbname=arl_local','--file='+filename
  ],{timeout:180000,encoding:'utf8'});
  if(dumped.status!==0)throw Error('pg_dump failed; no archive');
  await fs.chmod(filename,0o600);
  const checked=spawnSync('pg_restore',['--list',filename],
    {timeout:30000,encoding:'utf8'});
  if(checked.status!==0)throw Error('Backup verification failed; no archive');
  return filename;
}
async function archive(client,rows){
  const pending=rows.filter(r=>r.relationship_state==='prospect');
  if(!pending.length)return 0;
  let changed=0;
  for(const row of pending){
    const updated=await client.query(
      "UPDATE enkyron_crm_companies SET relationship_state='inactive',"+
      'record_version=record_version+1,updated_at=NOW() '+
      "WHERE workspace_key=$1 AND id=$2 AND name=$3 AND "+
      "relationship_state='prospect' AND record_version=$4 "+
      'RETURNING record_version',
      [scope,row.id,row.name,row.record_version]
    );
    if(updated.rowCount!==1||updated.rows[0].record_version!==row.record_version+1)
      throw Error('Company version changed during archive');
    await client.query(
      'INSERT INTO enkyron_crm_record_changes '+
      '(id,workspace_key,resource_kind,resource_id,old_version,new_version,'+
      'changed_fields,review_note,actor_local) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(),scope,'company',row.id,row.record_version,row.record_version+1,
       ['relationship_state'],
       'Archived test-only company by explicit owner request; dependencies retained.',
       operator]
    );
    await client.query(
      'INSERT INTO enkyron_crm_events '+
      '(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '+
      "VALUES($1,$2,'company',$3,'updated',$4)",
      [randomUUID(),scope,row.id,operator]
    );
    changed++;
  }
  return changed;
}
try{
  await db.connect();
  const identity=(await db.query(
    'SELECT current_database() AS db,current_user AS username'
  )).rows[0];
  if(identity?.db!=='arl_local'||identity.username!==operator)
    throw Error('Wrong database or Linux operator; no changes');
  const rows=await targetRows(db);
  console.log('LOCAL TEST COMPANY RECORDS');
  for(const row of rows){
    console.log('  '+row.name+' · '+row.id+' · '+row.relationship_state);
  }
  if(mode==='--check'){
    const linkReport=await linkedCounts(db,rows);
    for(const entry of linkReport){
      console.log('  '+entry.name+': '+entry.count+
        ' related records/relations remain protected');
      for(const item of entry.tables)console.log('    '+item);
    }
    console.log('READ-ONLY check: zero rows changed.');
  }else if(rows.every(r=>r.relationship_state==='inactive')){
    console.log('Both test companies are already archived; no changes.');
  }else{
    const backup=await verifiedBackup();
    await db.query('BEGIN');
    try{
      const current=await targetRows(db,true);
      if(JSON.stringify(current.map(x=>[x.id,x.record_version,x.relationship_state]))!==
         JSON.stringify(rows.map(x=>[x.id,x.record_version,x.relationship_state])))
        throw Error('Targets changed since preflight; no archive');
      const changed=await archive(db,current);
      await db.query('COMMIT');
      console.log('Archived '+changed+' exact test company records.');
      console.log('Linked contacts/tickets/imports and audit history were NOT deleted.');
      console.log('Archived records are hidden from the default CRM list; use search to find them.');
      console.log('Verified full PostgreSQL backup: '+backup);
    }catch(e){
      await db.query('ROLLBACK').catch(()=>{});
      throw e;
    }
  }
}catch(error){
  console.error('SAFE STOP:',error.message);
  process.exitCode=1;
}finally{
  await db.end().catch(()=>{});
}
