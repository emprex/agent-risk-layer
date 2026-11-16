#!/usr/bin/env node
// ENK-08 single-database PSA installer. No clones; at most ONE new backup
// created only after explicit confirmation, if no verified recent archive exists.
// Applies ONLY reviewed 118/119/120 inside one arl_local transaction.
// No Mail/Ticket/CRM migrations are executed, and no existing tables are edited
// apart from one additive opportunity-key index required by the mission FK.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import pg from 'pg';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SQL=Object.freeze([
  ['118_enkyron_psa_mission_planning.sql','d5bfe298b245d134b6d3f7a1e652fd9ae1270324'],
  ['119_enkyron_psa_work_items.sql','33689aa941d16b3bd29ae74fd9ffa0d07bfefee6'],
  ['120_enkyron_psa_time_entries.sql','e01f1ba4342a82b0eb180cd896af4156000c68f7'],
]);
const PSA=[
  'enkyron_psa_missions','enkyron_psa_mission_events',
  'enkyron_psa_work_items','enkyron_psa_work_item_events',
  'enkyron_psa_time_entries','enkyron_psa_time_events'
];
const HISTORICAL_021='673d3ce1373cf5dcde3414fee08c3dba15cadb0ca2f32afd7c50316fe5b1d7f6';
const HISTORICAL_NAME='021_paid_assessment_remediation_scope.sql';
const arg=process.argv[2];
if (!['--check','--apply'].includes(arg)||process.argv.length!==3){
  console.error('Usage: node scripts/enkyron-enk08-install.mjs --check|--apply');
  process.exit(2);
}
if (process.getuid?.()===0) {
  console.error('STOP: run as the ordinary ARL desktop user, never root');
  process.exit(2);
}
const actor=os.userInfo().username;
const fail=message=>{throw new Error('ENK-08 STOP: '+message);};
function execute(cmd,args,options={}){
  const x=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',timeout:20000,
    env:{...process.env,PGHOST:'/var/run/postgresql',PGPORT:'5432'},...options});
  if(x.error||x.status!==0)fail(cmd+' failed');
  return x.stdout.trim();
}
function sourceFiles(){
  return SQL.map(([name,gitSha])=>{
    const rel='docs/enkyron/sql/'+name;
    const file=path.join(ROOT,rel);
    if(!fs.existsSync(file))fail('reviewed PSA SQL missing');
    const actual=execute('git',['hash-object','--',rel]);
    if(actual!==gitSha)fail('reviewed PSA SQL changed: '+name);
    const content=fs.readFileSync(file,'utf8');
    const checksum=crypto.createHash('sha256').update(content).digest('hex');
    return {name,content,checksum};
  });
}
async function backupCandidate(){
  const dir=path.join(ROOT,'data','backups');
  if(!fs.existsSync(dir))return null;
  const directory=fs.lstatSync(dir);
  if(!directory.isDirectory()||directory.isSymbolicLink()||
     directory.uid!==process.getuid()||(directory.mode&0o077)!==0)
    return null;
  const all=fs.readdirSync(dir).filter(x=>x.endsWith('.dump'))
    .map(x=>path.join(dir,x)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  for(const file of all){
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
       st.uid!==process.getuid()||(st.mode&0o077)!==0||
       Date.now()-st.mtimeMs>24*3600*1000)continue;
    const meta=file+'.manifest.json';
    if(!fs.existsSync(meta))continue;
    const mst=fs.lstatSync(meta);
    if(!mst.isFile()||mst.isSymbolicLink()||mst.uid!==process.getuid()||
       (mst.mode&0o077)!==0)continue;
    let data;
    try{data=JSON.parse(fs.readFileSync(meta,'utf8'));}
    catch{continue;}
    if(data.schema!=='arl.postgresql.backup.v1'||data.verified!==true||
       data.archive!==path.basename(file)||data.bytes!==st.size||
       !/^[a-f0-9]{64}$/.test(data.sha256||''))continue;
    let source;
    try{source=new URL(data.source);}
    catch{continue;}
    if(!['postgres:','postgresql:'].includes(source.protocol)||
       !['localhost','127.0.0.1','[::1]'].includes(source.hostname)||
       decodeURIComponent(source.pathname)!=='/arl_local')continue;
    const created=Date.parse(data.createdAt||'');
    if(!Number.isFinite(created)||created>Date.now()||
       Date.now()-created>24*3600*1000)continue;
    const digest=crypto.createHash('sha256');
    for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024}))
      digest.update(chunk);
    if(digest.digest('hex')!==data.sha256)continue;
    const archive=spawnSync('pg_restore',['--list',file],{encoding:'utf8',
      timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
    if(archive.status!==0||archive.error||
       archive.stdout.split('\n').filter(line=>line&&!line.startsWith(';')).length<10)
      continue;
    return {file,sha256:data.sha256,created_at:data.createdAt};
  }
  return null;
}

/**
 * Make exactly one private, manifest-backed PostgreSQL archive if there is no
 * verified recent one. This is an actual arl_local point-in-time backup, NOT
 * a database clone. Only invoked after the operator's interactive confirmation.
 * Never rotate or remove existing backups.
 */
async function createPreInstallBackup(){
  const dir=path.join(ROOT,'data','backups');
  if(!fs.existsSync(dir))fail('existing private data/backups directory missing');
  const directory=fs.lstatSync(dir);
  if(!directory.isDirectory()||directory.isSymbolicLink()||
     directory.uid!==process.getuid()||(directory.mode&0o077)!==0)
    fail('backup directory is not private and operator-owned');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const nonce=crypto.randomBytes(4).toString('hex');
  const name='arl_local-enk08-before-install-'+stamp+'-'+nonce+'.dump';
  const file=path.join(dir,name);
  const manifest=file+'.manifest.json';
  let created=false,manifestCreated=false;
  try{
    // Exclusive private creation prevents overwriting ANY existing file.
    const fd=fs.openSync(file,'wx',0o600);
    fs.closeSync(fd);
    created=true;
    const dump=spawnSync('pg_dump',[
      '--format=custom','--compress=9','--no-owner','--no-privileges',
      '--host=/var/run/postgresql','--port=5432',
      '--username='+actor,'--dbname=arl_local','--file='+file,
    ],{
      cwd:ROOT,encoding:'utf8',timeout:180000,
      stdio:['ignore','pipe','pipe'],
      env:{...process.env,PGHOST:'/var/run/postgresql',PGPORT:'5432',
        PGDATABASE:'arl_local',PGUSER:actor,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000'},
    });
    if(dump.status!==0||dump.error)fail('pg_dump could not produce a full database archive');
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
       stat.nlink!==1||stat.size<1024)fail('backup archive is invalid');
    fs.chmodSync(file,0o600);
    const toc=spawnSync('pg_restore',['--list',file],{
      cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,
      stdio:['ignore','pipe','pipe'],
    });
    const archiveEntries=(toc.stdout||'').split('\n')
      .filter(line=>line&&!line.startsWith(';')).length;
    if(toc.status!==0||toc.error||archiveEntries<10)
      fail('backup PostgreSQL archive verification failed');
    const digest=crypto.createHash('sha256');
    for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024}))
      digest.update(chunk);
    const sha256=digest.digest('hex');
    const createdAt=new Date().toISOString();
    const data={
      schema:'arl.postgresql.backup.v1',format:'postgresql-custom',
      source:'postgresql://localhost:5432/arl_local',
      source_transport:'local Unix socket /var/run/postgresql',
      archive:name,createdAt,bytes:stat.size,sha256,
      archiveEntries,verified:true,
    };
    fs.writeFileSync(manifest,JSON.stringify(data,null,2)+'\n',{
      encoding:'utf8',mode:0o600,flag:'wx'});
    manifestCreated=true;
    const checked=await backupCandidate();
    if(!checked||checked.file!==file||checked.sha256!==sha256)
      fail('generated backup did not pass the existing verification gate');
    return checked;
  }catch(error){
    // Remove ONLY incomplete files just created by this specific attempt.
    // Never touch any other pre-existing archive or code snapshot.
    if(manifestCreated)fs.rmSync(manifest,{force:true});
    if(created)fs.rmSync(file,{force:true});
    throw error;
  }
}

async function checkState(client,files){
  const ident=(await client.query(
    "SELECT current_database() AS db,current_user AS actor,"
    +"current_setting('port') AS port,"
    +"current_setting('transaction_read_only') AS readonly"
  )).rows[0];
  if(ident?.db!=='arl_local'||ident?.actor!==actor||ident?.port!=='5432')
    fail('wrong PostgreSQL database, user or server port');
  const history=(await client.query(
    'SELECT version,checksum FROM schema_migrations'
  )).rows;
  const applied=new Map(history.map(row=>[row.version,row.checksum]));
  if(applied.size!==history.length||applied.get(HISTORICAL_NAME)!==HISTORICAL_021)
    fail('unexpected historical schema_migrations state');
  for(const file of files)
    if(applied.has(file.name)&&applied.get(file.name)!==file.checksum)
      fail('existing PSA migration checksum differs: '+file.name);
  const prereq=(await client.query(
    "SELECT to_regclass('public.enkyron_crm_companies') AS companies,"
    +"to_regclass('public.enkyron_crm_opportunities') AS opportunities,"
    +"to_regprocedure('public.enkyron_crm_events_immutable()') AS audit"
  )).rows[0];
  if(!prereq||Object.values(prereq).some(x=>!x))fail('existing CRM schema prerequisites unavailable');
  const found=(await client.query(
    'SELECT c.relname FROM pg_catalog.pg_class c '
    +'JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace '
    +"WHERE n.nspname='public' AND c.relkind IN ('r','p') "
    +'AND c.relname=ANY($1::text[])',[PSA]
  )).rows.map(x=>x.relname);
  const installed=files.every(x=>applied.has(x.name))&&found.length===PSA.length;
  if((found.length||files.some(x=>applied.has(x.name)))&&!installed)
    fail('partial or unregistered PSA installation; no changes made');
  return {installed,existing_psa_tables:found.length,
    migration_versions:files.map(x=>({name:x.name,checksum:x.checksum})),
    database:'arl_local',actor,port:5432};
}
async function main(){
  const files=sourceFiles();
  const client=new pg.Client({
    host:'/var/run/postgresql',port:5432,database:'arl_local',user:actor,
    connectionTimeoutMillis:5000,
    options:arg==='--check'
      ?'-c default_transaction_read_only=on -c statement_timeout=12000'
      :'-c statement_timeout=30000 -c lock_timeout=3000'
  });
  await client.connect();
  let open=false;
  try{
    if(arg==='--check'){
      await client.query('BEGIN READ ONLY');
      open=true;
      const status=await checkState(client,files);
      await client.query('COMMIT');
      open=false;
      const backup=await backupCandidate();
      console.log(JSON.stringify({...status,
        existing_backup_verified:!!backup,
        backup_name:backup?path.basename(backup.file):null,
        write_performed:false},null,2));
      return;
    }
    // Validate all schema prerequisites BEFORE creating any new archive.
    await client.query('BEGIN READ ONLY');
    open=true;
    const preliminary=await checkState(client,files);
    await client.query('ROLLBACK');
    open=false;
    if(preliminary.installed){
      console.log('ENK-08 already installed. No backup or schema changes.');
      return;
    }
    let backup=await backupCandidate();
    if(!process.stdin.isTTY)fail('interactive operator confirmation required');
    const rl=createInterface({input:process.stdin,output:process.stdout});
    let answer='';
    try{
      answer=await rl.question(
        backup
          ? 'Install ONLY PSA 118/119/120 on arl_local with verified backup '
            +path.basename(backup.file)+'? Type INSTALL ENK08: '
          : 'No recent verified database backup. Create exactly ONE local '
            +'private (not encrypted) arl_local dump, verify it, then '
            +'install ONLY PSA 118/119/120? '
            +'Type INSTALL ENK08: ');
    }finally{rl.close();}
    if(answer!=='INSTALL ENK08')fail('operator did not confirm');
    if(!backup){
      backup=await createPreInstallBackup();
      console.log('One PostgreSQL archive created and SHA-256 verified: '
        +path.basename(backup.file));
      console.log('This archive is a recovery point, not a tested restore.');
    }
    await client.query('BEGIN');
    open=true;
    await client.query("SET LOCAL lock_timeout='3000ms'");
    await client.query("SET LOCAL statement_timeout='30000ms'");
    await client.query('SELECT pg_advisory_xact_lock(814720260)');
    const status=await checkState(client,files);
    if(status.installed){
      await client.query('ROLLBACK');open=false;
      console.log('ENK-08 already installed with matching checksums. No changes.');
      return;
    }
    for(const file of files){
      await client.query(file.content);
      await client.query(
        'INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',
        [file.name,file.checksum]
      );
    }
    const done=await checkState(client,files);
    if(!done.installed)fail('post-install schema verification failed');
    await client.query('COMMIT');open=false;
    console.log('ENK-08 installed: missions, tasks and time logs. '
      +'No unrelated migrations or clones; recovery archive retained.');
  }finally{
    if(open)await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}
main().catch(err=>{
  console.error(String(err?.message||'ENK-08 install aborted'));
  process.exitCode=2;
});
