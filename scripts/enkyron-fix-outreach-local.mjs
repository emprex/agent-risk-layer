#!/usr/bin/env node
// One-time local ENKYRON commercial-origin repair for the two known 2026-11-09
// LinkedIn outreach records. Explicit operator invocation; never auto-run.
// Backup first, transactionally apply migration 100, revalidate every identity,
// detach opportunity ticket origin, revoke stale company-ticket link; keep history.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {correctCommercialOrigin} from '../desktop/enkyron-crm-opportunities.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const actor=os.userInfo().username;
const workspace='local:'+actor;
const socket='/var/run/postgresql';
const database='arl_local';
const version='100_enkyron_crm_company_direct_opportunities.sql';
const entries=[
 {name:'Threat ResQ',company_id:'3491ea38-c5f9-4f9b-8bf8-34ac31aa7661',
  contact_id:'b8588fe8-a8c3-48ab-b412-b8a4a629f67a',
  opportunity_id:'abb0616c-0c95-4f7e-9c3a-b49812f459aa',
  ticket_number:'ARL-2026-000006',
  title:'Partnership enquiry - Threat ResQ - LinkedIn - 2026-11-09',
  min_notes:7},
 {name:'Xurrent',company_id:'f2059f56-4a25-4eaa-9cf4-eb5ecda60ba1',
  contact_id:'61affc22-18a5-4f5b-8972-b330079980b6',
  opportunity_id:'68e65606-1042-423a-8a69-b93a513cdc2d',
  ticket_number:'ARL-2026-000007',
  title:'Internal commercial lead - Xurrent - LinkedIn - 2026-11-09',
  min_notes:4}
];
function backup(){
 const dir=path.join(root,'data','backups');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const file=path.join(dir,'enkyron-crm-before-ticketless-'+stamp+'.dump');
 const args=['--host',socket,'--username',actor,'--dbname',database,
  '--format=custom','--no-owner','--no-privileges','--file',file];
 const dump=spawnSync('pg_dump',args,{encoding:'utf8',timeout:120000});
 if(dump.error||dump.status!==0)throw Error('Backup failed: '+(dump.stderr||dump.error?.message));
 if(!fs.existsSync(file)||fs.statSync(file).size<1)throw Error('Backup empty');
 fs.chmodSync(file,0o600);
 const verify=spawnSync('pg_restore',['--list',file],{encoding:'utf8',timeout:15000});
 if(verify.error||verify.status!==0||!verify.stdout.includes('TABLE'))
  throw Error('Backup validation failed; stop without database changes');
 const digest=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 console.log('Verified backup:',file);
 console.log('Backup SHA256:',digest);
 return file;
}
async function migrate(pool){
 const file=path.join(root,'migrations',version);
 const sql=fs.readFileSync(file,'utf8');
 const digest=createHash('sha256').update(sql).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(814720260)');
  const previous=(await client.query(
   "SELECT version FROM schema_migrations WHERE version='099_enkyron_crm_sow_draft_versions.sql'"
  )).rows[0];
  if(!previous)throw Error('Migration 099 missing; apply earlier ENKYRON migrations first');
  const existing=(await client.query(
   'SELECT checksum FROM schema_migrations WHERE version=$1',[version]
  )).rows[0];
  if(existing){
   if(existing.checksum!==digest)throw Error('Migration checksum mismatch: '+version);
   console.log('Migration 100 verified already installed');
  }else{
   await client.query(sql);
   await client.query(
    'INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)',[version,digest]
   );
   console.log('Migration 100 applied');
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
async function inspect(pool,item){
 const rows=(await pool.query(
  'SELECT o.id,o.company_id,o.source_ticket_id,o.prospect_id,o.stage,o.version,'
  +'c.name AS company_name,t.id AS ticket_id,t.ticket_number,t.title,'
  +'t.client_name,t.target_reference,t.linked_project_id,t.linked_assessment_id,'
  +'t.status,t.archived_at '
  +'FROM enkyron_crm_opportunities o '
  +'JOIN enkyron_crm_companies c ON c.id=o.company_id AND c.workspace_key=o.workspace_key '
  +'JOIN arl_workbench_tickets t ON t.ticket_number=$3 '
  +'WHERE o.workspace_key=$1 AND o.id=$2',
  [workspace,item.opportunity_id,item.ticket_number]
 )).rows;
 if(rows.length!==1)throw Error('Missing/duplicate reviewed opportunity '+item.name);
 const x=rows[0];
 if(x.company_id!==item.company_id||x.company_name!==item.name||
    x.prospect_id!==null||x.title!==item.title||x.client_name!==item.name||
    x.target_reference!=='intake:manual'||x.linked_project_id||x.linked_assessment_id)
  throw Error('Source mismatch; refuse to change '+item.name);
 const contact=(await pool.query(
  'SELECT id FROM enkyron_crm_contacts WHERE workspace_key=$1 AND company_id=$2 AND id=$3',
  [workspace,item.company_id,item.contact_id]
 )).rows[0];
 if(!contact)throw Error('Contact mismatch '+item.name);
 const activity=(await pool.query(
  'SELECT count(*)::int AS n FROM enkyron_crm_activities WHERE workspace_key=$1 AND opportunity_id=$2',
  [workspace,item.opportunity_id]
 )).rows[0].n;
 if(activity<item.min_notes)throw Error('Missing correspondence; refuse to modify '+item.name);
 const corrections=(await pool.query(
  'SELECT id,old_source_ticket_id FROM enkyron_crm_opportunity_origin_corrections '
  +'WHERE workspace_key=$1 AND opportunity_id=$2',
  [workspace,item.opportunity_id]
 )).rows;
 if(corrections.length>1)throw Error('Unexpected duplicate correction');
 const revoked=(await pool.query(
  'SELECT id FROM enkyron_crm_ticket_link_revocations '
  +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
  [workspace,item.company_id,x.ticket_id]
 )).rows;
 if(x.source_ticket_id===null){
  if(corrections.length!==1||corrections[0].old_source_ticket_id!==x.ticket_id||
    revoked.length!==1)throw Error('Partially corrected state: '+item.name);
  return {...x,activity,already_corrected:true};
 }
 if(x.source_ticket_id!==x.ticket_id||corrections.length||revoked.length)
  throw Error('Opportunity/ticket history mismatch: '+item.name);
 const link=(await pool.query(
  'SELECT id FROM enkyron_crm_effective_ticket_links '
  +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
  [workspace,item.company_id,x.ticket_id]
 )).rows;
 if(link.length!==1)throw Error('Reviewed company/ticket link unavailable: '+item.name);
 return {...x,activity,already_corrected:false};
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--apply')
  throw Error('Run only with --apply after reviewing PR #521 and closing ENKYRON.');
 const pool=new pg.Pool({host:socket,database,user:actor,max:2,
  connectionTimeoutMillis:5000,statement_timeout:15000});
 try{
  // Before migration, verify that this is the correct LOCAL database.
  const identity=(await pool.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
  if(identity.db!==database||identity.usr!==actor)
   throw Error('Wrong local database/operator');
  backup();
  await migrate(pool);
  const checked=[];
  for(const item of entries){
   const record=await inspect(pool,item);
   console.log('Reviewed:',item.name,item.ticket_number,'activity count:',record.activity,
    record.already_corrected?'already corrected':'correction required');
   checked.push(record);
  }
  for(let i=0;i<entries.length;i++){
   if(checked[i].already_corrected)continue;
   const item=entries[i],record=checked[i];
   await correctCommercialOrigin(pool,{
    company_id:item.company_id,opportunity_id:item.opportunity_id,
    ticket_id:record.ticket_id,ticket_number_at_review:item.ticket_number,
    company_name_at_review:item.name,
    reason:'The LinkedIn conversation was internal ARL commercial outreach, not a received client service request. Keep original audit history and detach it from the active CRM opportunity.',
    confirmed:true
   },actor);
   console.log('Corrected:',item.name);
  }
  for(const item of entries){
   const record=await inspect(pool,item);
   if(!record.already_corrected)throw Error('Post-correction check failed: '+item.name);
   console.log('VERIFIED:',item.name,'opportunity:',item.opportunity_id,
    'notes:',record.activity,'service-ticket origin: none',
    'original ticket retained:',item.ticket_number);
  }
  console.log('ENKYRON commercial correction complete. No messages sent, no assessment launched.');
 }finally{await pool.end();}
}
main().catch(e=>{console.error('STOP -',e.message);process.exitCode=1;});
