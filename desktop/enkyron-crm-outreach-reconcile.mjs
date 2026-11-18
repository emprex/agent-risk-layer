#!/usr/bin/env node
// ENK-OUTREACH-REPAIR-V2: operator-approved reconciliation of ONE existing
// recorded outgoing email; never sends mail or touches qualification history.
import os from 'node:os';
import pg from 'pg';
import {syncConfirmedOutreachFollowup} from './enkyron-crm-confirmed-outreach-followup.mjs';
import {resolveEnkyronDatabase} from './enkyron-uat-database.mjs';

const flags=process.argv.slice(2);
function arg(name){const i=flags.indexOf(name);return i<0?null:flags[i+1];}
const companyName=arg('--company');
const applying=flags.includes('--apply');
const confirmed=flags.includes('--confirm');
if(!companyName||!/^[A-Za-z0-9 ._-]{1,100}$/.test(companyName)
    ||(applying&&!confirmed)
    ||flags.some((x,i)=>x.startsWith('--')&&!['--company','--apply','--confirm'].includes(x))){
  process.stderr.write('Usage: node desktop/enkyron-crm-outreach-reconcile.mjs --company Dust [--apply --confirm]\n');
  process.exit(2);
}
const target=resolveEnkyronDatabase();
if(target.uat||target.database!=='arl_local'){
  process.stderr.write('This reconciliation is restricted to the normal local database; no UAT changes.\n');
  process.exit(2);
}
const actor=os.userInfo().username;
const scope='local:'+actor;
const pool=new pg.Pool({host:'/var/run/postgresql',port:5432,user:actor,
  database:'arl_local',max:1,connectionTimeoutMillis:5000});
let client;
try{
  client=await pool.connect();
  await client.query('BEGIN'+(applying?'':' READ ONLY'));
  const companies=(await client.query(
    'SELECT id,name FROM enkyron_crm_companies '
    +'WHERE workspace_key=$1 AND LOWER(name)=LOWER($2) LIMIT 2',
    [scope,companyName]
  )).rows;
  if(companies.length!==1){
    process.stdout.write(`STOP: ${companies.length} exact matching companies. No changes.\n`);
  }else{
    const company=companies[0];
    const opportunities=(await client.query(
      'SELECT id,stage,next_action,due_date FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND company_id=$2 ORDER BY updated_at DESC LIMIT 3',
      [scope,company.id]
    )).rows;
    const reviews=(await client.query(
      'SELECT fit_status,priority,recorded_at FROM enkyron_crm_qualification_reviews '
      +'WHERE workspace_key=$1 AND company_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [scope,company.id]
    )).rows;
    // Explicit company association, documented matching contact and proof
    // within 30 days. No automatic guess based on a matching domain.
    const proofRows=(await client.query(
      'SELECT d.id AS draft_id,d.recipient_email,d.subject,'+
      's.completed_at AS sent_at,\'provider_accepted\' AS proof_kind '+
      'FROM enkyron_crm_mail_drafts d '+
      'JOIN enkyron_mail_send_attempts s ON s.workspace_key=d.workspace_key '+
      'AND s.draft_id=d.id AND s.outcome=\'accepted\' '+
      'WHERE d.workspace_key=$1 AND d.company_id=$2 '+
      'AND s.completed_at>=NOW()-INTERVAL \'30 days\' '+
      'UNION ALL '+
      'SELECT d.id AS draft_id,d.recipient_email,d.subject,'+
      'm.sent_at AS sent_at,\'external_operator_reported\' AS proof_kind '+
      'FROM enkyron_crm_mail_drafts d '+
      'JOIN enkyron_crm_mail_manual_sends m ON m.workspace_key=d.workspace_key '+
      'AND m.draft_id=d.id '+
      'WHERE d.workspace_key=$1 AND d.company_id=$2 '+
      'AND m.sent_at>=NOW()-INTERVAL \'30 days\' '+
      'ORDER BY sent_at DESC LIMIT 4',
      [scope,company.id]
    )).rows;
    process.stdout.write(`Company: ${company.name}\n`);
    process.stdout.write(`Qualification: ${reviews[0]?.fit_status||'none'}; priority: ${reviews[0]?.priority||'none'}\n`);
    process.stdout.write(`Direct opportunities: ${opportunities.length}`+
      (opportunities.length?` (${opportunities.map(o=>o.stage).join(', ')})`:'')+'\n');
    process.stdout.write(`Confirmed, company-linked send records in last 30 days: ${proofRows.length}${proofRows.length===4?' (at least 4)':''}\n`);
    for(const p of proofRows.slice(0,3)){
      process.stdout.write(`  ${new Date(p.sent_at).toISOString().slice(0,16)} `+
        `${p.proof_kind} | to ${p.recipient_email} | ${String(p.subject||'').slice(0,110)}\n`);
    }
    if(proofRows.length!==1){
      process.stdout.write('STOP: need exactly one confirmed send explicitly linked to this company. No changes.\n');
    }else{
      const proof=proofRows[0];
      const contact=(await client.query(
        'SELECT id FROM enkyron_crm_contacts WHERE workspace_key=$1 '+
        'AND company_id=$2 AND LOWER(email)=LOWER($3) LIMIT 1',
        [scope,company.id,proof.recipient_email]
      )).rows[0];
      if(!contact){
        process.stdout.write('STOP: recipient does not match a registered company contact. No changes.\n');
      }else if(!applying){
        process.stdout.write('PREVIEW ONLY. If this is the correct email, re-run with --apply --confirm.\n');
      }else{
        const result=await syncConfirmedOutreachFollowup(client,{
          workspaceKey:scope,actor,draftId:proof.draft_id,
          sentAt:new Date(proof.sent_at).toISOString(),proofKind:proof.proof_kind
        });
        if(result.updated){
          await client.query('COMMIT');
          process.stdout.write(`SUCCESS: ${result.created?'created':'updated'} one opportunity; `+
            `stage=${result.stage}; due=${result.due_date}; id=${result.opportunity_id}\n`);
          client.release();client=null;
        }else{
          process.stdout.write(`NO CHANGE: ${result.reason}. No email was sent.\n`);
        }
      }
    }
  }
  if(client){await client.query('ROLLBACK');client.release();client=null;}
}catch(error){
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();client=null;}
  process.stderr.write('ERROR: '+String(error?.message||error).slice(0,500)+'\n');
  process.exitCode=1;
}finally{await pool.end();}
