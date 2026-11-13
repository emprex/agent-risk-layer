#!/usr/bin/env node
// One-time cleanup of two FALSE, operator-generated 2026-11-09 Client Desk tickets.
// This is intentionally a hard delete, per explicit operator instruction.
// Do not use for real customer service tickets. All CRM opportunity/activity
// records are preserved. Backup, identity pinning and one transaction are required.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const actor=os.userInfo().username;
const workspace='local:'+actor;
const DB='arl_local',HOST='/var/run/postgresql';
const ENTRIES=[
  {company:'Threat ResQ',companyId:'3491ea38-c5f9-4f9b-8bf8-34ac31aa7661',
    contactId:'b8588fe8-a8c3-48ab-b412-b8a4a629f67a',
    opportunityId:'abb0616c-0c95-4f7e-9c3a-b49812f459aa',
    number:'ARL-2026-000006',
    title:'Partnership enquiry - Threat ResQ - LinkedIn - 2026-11-09',
    minimumActivities:7},
  {company:'Xurrent',companyId:'f2059f56-4a25-4eaa-9cf4-eb5ecda60ba1',
    contactId:'61affc22-18a5-4f5b-8972-b330079980b6',
    opportunityId:'68e65606-1042-423a-8a69-b93a513cdc2d',
    number:'ARL-2026-000007',
    title:'Internal commercial lead - Xurrent - LinkedIn - 2026-11-09',
    minimumActivities:5}
];
function backup(){
  const dir=path.join(root,'data','backups');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const destination=path.join(dir,'enkyron-before-false-ticket-removal-'+stamp+'.dump');
  const args=['--host',HOST,'--username',actor,'--dbname',DB,
    '--format=custom','--no-owner','--no-privileges','--file',destination];
  const run=spawnSync('pg_dump',args,{encoding:'utf8',timeout:120000});
  if(run.error||run.status!==0)throw new Error(
    'Backup failed: '+(run.stderr||run.error?.message||run.status));
  if(!fs.existsSync(destination)||fs.statSync(destination).size<1)
    throw new Error('Backup empty');
  fs.chmodSync(destination,0o600);
  const verify=spawnSync('pg_restore',['--list',destination],
    {encoding:'utf8',timeout:30000});
  if(verify.error||verify.status!==0||!verify.stdout.includes('TABLE'))
    throw new Error('Backup could not be verified');
  const hash=createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  console.log('BACKUP VERIFIED:',destination);
  console.log('BACKUP SHA256:',hash);
}
async function count(c,sql,args){return Number((await c.query(sql,args)).rows[0].n);}
async function inspect(c,e){
  const company=(await c.query(
    'SELECT id,name FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
    [workspace,e.companyId])).rows[0];
  if(!company||company.name!==e.company)throw Error('Wrong CRM company: '+e.company);
  const contact=(await c.query(
    'SELECT id FROM enkyron_crm_contacts WHERE workspace_key=$1 AND company_id=$2 AND id=$3',
    [workspace,e.companyId,e.contactId])).rows[0];
  if(!contact)throw Error('Missing CRM contact: '+e.company);
  const opportunity=(await c.query(
    'SELECT id,company_id,prospect_id,source_ticket_id,stage,next_action,version '
    +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
    [workspace,e.opportunityId])).rows[0];
  if(!opportunity||opportunity.company_id!==e.companyId||
     opportunity.prospect_id!==null||opportunity.source_ticket_id!==null)
    throw Error('Opportunity origin is not clean: '+e.company);
  const activities=await count(c,
    'SELECT count(*)::int AS n FROM enkyron_crm_activities '
    +'WHERE workspace_key=$1 AND opportunity_id=$2',[workspace,e.opportunityId]);
  if(activities<e.minimumActivities)
    throw Error('Unexpected activity count for '+e.company+': '+activities);
  const found=(await c.query(
    'SELECT id,ticket_number,title,client_name,target_reference,linked_project_id,'
    +'linked_assessment_id FROM arl_workbench_tickets '
    +'WHERE ticket_number=$1 FOR UPDATE',[e.number])).rows;
  if(!found.length){
    // Repeated invocation must only verify the completed correction.
    const correction=await count(c,
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunity_origin_corrections '
      +'WHERE workspace_key=$1 AND opportunity_id=$2',[workspace,e.opportunityId]);
    if(correction)throw Error('Ticket absent but stale origin correction remains');
    console.log('ALREADY REMOVED:',e.number,'CRM activities:',activities);
    return {entry:e,missing:true,activities};
  }
  if(found.length!==1)throw Error('Duplicate ticket number '+e.number);
  const t=found[0];
  if(t.title!==e.title||t.client_name!==e.company||
     t.target_reference!=='intake:manual'||
     t.linked_project_id!==null||t.linked_assessment_id!==null)
    throw Error('Ticket does not match the synthetic sales intake: '+e.number);
  const source=await count(c,
    'SELECT count(*)::int AS n FROM enkyron_crm_opportunities WHERE source_ticket_id=$1',
    [t.id]);
  if(source!==0)throw Error('A live opportunity still refers to '+e.number);
  const corrections=(await c.query(
    'SELECT id,company_id,opportunity_id FROM enkyron_crm_opportunity_origin_corrections '
    +'WHERE workspace_key=$1 AND old_source_ticket_id=$2',[workspace,t.id])).rows;
  const links=(await c.query(
    'SELECT id,company_id FROM enkyron_crm_ticket_links WHERE ticket_id=$1',
    [t.id])).rows;
  const revocations=(await c.query(
    'SELECT id,link_id,company_id FROM enkyron_crm_ticket_link_revocations '
    +'WHERE ticket_id=$1',[t.id])).rows;
  if(corrections.length!==1||corrections[0].opportunity_id!==e.opportunityId||
     corrections[0].company_id!==e.companyId||
     links.length!==1||links[0].company_id!==e.companyId||
     revocations.length!==1||revocations[0].company_id!==e.companyId||
     revocations[0].link_id!==links[0].id)
    throw Error('Historical ticket association differs: '+e.number);
  const unexpected=[
    ['reassigned',await count(c,
      'SELECT count(*)::int AS n FROM enkyron_crm_ticket_reassignments WHERE ticket_id=$1',
      [t.id])],
    ['reassigned contacts',await count(c,
      'SELECT count(*)::int AS n FROM enkyron_crm_reassigned_contact_ticket_links WHERE ticket_id=$1',
      [t.id])],
    ['triage',await count(c,
      'SELECT count(*)::int AS n FROM enkyron_ticket_triage_reviews WHERE ticket_id=$1',
      [t.id])],
    ['workbench notes',await count(c,
      'SELECT count(*)::int AS n FROM arl_workbench_notes WHERE ticket_id=$1',
      [t.id])],
    ['other-workspace contact links',await count(c,
      'SELECT count(*)::int AS n FROM enkyron_crm_contact_ticket_links '
      +'WHERE ticket_id=$1 AND (workspace_key<>$2 OR company_id<>$3)',
      [t.id,workspace,e.companyId])]
  ];
  for(const [label,n] of unexpected)if(n!==0)
    throw Error('Unexpected '+label+' on '+e.number+': '+n+'. No deletion.');
  const events=await count(c,
    'SELECT count(*)::int AS n FROM arl_workbench_ticket_events WHERE ticket_id=$1',
    [t.id]);
  if(events<1)throw Error('Source ticket creation event missing: '+e.number);
  return {entry:e,ticketId:t.id,activities,events};
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--apply')
    throw Error('Explicit --apply is required');
  const pool=new pg.Pool({host:HOST,database:DB,user:actor,max:1,
    connectionTimeoutMillis:5000,statement_timeout:30000});
  try{
    const identity=(await pool.query(
      'SELECT current_database() AS db,current_user AS usr')).rows[0];
    if(identity.db!==DB||identity.usr!==actor)
      throw Error('Unexpected database or operator; no changes');
    const migration=await pool.query(
      'SELECT version FROM schema_migrations '
      +"WHERE version='100_enkyron_crm_company_direct_opportunities.sql'");
    if(migration.rows.length!==1)throw Error('CRM migration 100 missing');
    backup();
    const c=await pool.connect();
    let tx=false;
    try{
      await c.query('BEGIN');
      tx=true;
      await c.query("SET LOCAL lock_timeout = '10s'");
      await c.query('SELECT pg_advisory_xact_lock(814720260)');
      const inspected=[];
      for(const e of ENTRIES)inspected.push(await inspect(c,e));
      // Abort before any deletion unless both known entities are safe to process.
      const todo=inspected.filter(x=>!x.missing);
      if(todo.length){
        // Disabling precisely these append-only triggers is confined to this
        // transaction. PostgreSQL DDL locks prevent concurrent partial views.
        const triggers=[
          ['enkyron_crm_opportunity_origin_corrections',
           'enkyron_crm_opportunity_origin_corrections_no_modify'],
          ['enkyron_crm_contact_ticket_links','enkyron_crm_contact_ticket_no_modify'],
          ['enkyron_crm_ticket_link_revocations',
           'enkyron_crm_ticket_link_revocations_immutable'],
          ['enkyron_crm_ticket_links','enkyron_crm_ticket_links_no_modify']
        ];
        for(const [table,trigger] of triggers)
          await c.query('ALTER TABLE '+table+' DISABLE TRIGGER '+trigger);
        for(const {entry:e,ticketId:id} of todo){
          const del=async (sql,args,expected=null)=>{
            const result=await c.query(sql,args);
            if(expected!==null&&result.rowCount!==expected)
              throw Error('Unexpected deletion count '+result.rowCount+
                '; wanted '+expected+' for '+e.number);
            return result.rowCount;
          };
          await del('DELETE FROM enkyron_crm_opportunity_origin_corrections '
            +'WHERE workspace_key=$1 AND opportunity_id=$2 AND old_source_ticket_id=$3',
            [workspace,e.opportunityId,id],1);
          await del('DELETE FROM enkyron_crm_contact_ticket_links '
            +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
            [workspace,e.companyId,id]);
          await del('DELETE FROM enkyron_crm_ticket_link_revocations '
            +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
            [workspace,e.companyId,id],1);
          await del('DELETE FROM enkyron_crm_ticket_links '
            +'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$3',
            [workspace,e.companyId,id],1);
          await del('DELETE FROM arl_workbench_ticket_events WHERE ticket_id=$1',[id]);
          await del('DELETE FROM arl_workbench_tickets WHERE id=$1',[id],1);
          console.log('REMOVED FALSE TICKET:',e.number);
        }
        for(const [table,trigger] of triggers)
          await c.query('ALTER TABLE '+table+' ENABLE TRIGGER '+trigger);
      }
      for(const {entry:e,activities} of inspected){
        const tickets=await count(c,
          'SELECT count(*)::int AS n FROM arl_workbench_tickets WHERE ticket_number=$1',
          [e.number]);
        if(tickets!==0)throw Error('Ticket remains: '+e.number);
        const opp=await count(c,
          'SELECT count(*)::int AS n FROM enkyron_crm_opportunities '
          +'WHERE workspace_key=$1 AND id=$2 AND company_id=$3 AND source_ticket_id IS NULL',
          [workspace,e.opportunityId,e.companyId]);
        const notes=await count(c,
          'SELECT count(*)::int AS n FROM enkyron_crm_activities '
          +'WHERE workspace_key=$1 AND opportunity_id=$2',
          [workspace,e.opportunityId]);
        if(opp!==1||notes!==activities)
          throw Error('CRM opportunity or messages changed: '+e.company);
        console.log('VERIFIED CRM:',e.company,'opportunity preserved; messages/notes:',notes);
      }
      await c.query('COMMIT');
      tx=false;
      console.log('SUCCESS: both false tickets absent. CRM data preserved.');
    }catch(err){
      if(tx)await c.query('ROLLBACK').catch(()=>{});
      throw err;
    }finally{c.release();}
  }finally{await pool.end();}
}
main().catch(error=>{
  console.error('STOP - transaction rolled back if started:',error.message);
  process.exitCode=1;
});
