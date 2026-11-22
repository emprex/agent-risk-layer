#!/usr/bin/env node
// ENK-06 / synthetic UAT data only, in one dedicated new database.
// Never copy, connect to, change or inspect arl_local or customer records.
// No mail provider calls, uploads, data migration or external file reads.
import os from 'node:os';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {resolveEnkyronDatabase,verifyEnkyronUatDatabase,
  ENKYRON_ENK06_UAT_DATABASE,ENKYRON_ENK06_UAT_MARKER}
  from '../desktop/enkyron-uat-database.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;
const ACTOR=()=>os.userInfo().username;
export const SYNTHETIC_IDS=Object.freeze({
  company_id:'aaaaaaaa-1111-4aaa-8aaa-111111111111',
  ticket_id:'bbbbbbbb-2222-4bbb-8bbb-222222222222',
  thread_id:'cccccccc-3333-4ccc-8ccc-333333333333',
  message_id:'dddddddd-4444-4ddd-8ddd-444444444444',
  attachment_id:'eeeeeeee-5555-4eee-8eee-555555555555'
});
const NAME='ENK06 Synthetic Demo Company — NOT REAL';
const TICKET_NO='CI-ENK06-000001';
const SUBJECT='ENK06 SYNTHETIC — review dossier filing';
const FILE='enk06-synthetic-proof.txt';
const BYTES=Buffer.from('ENK06 synthetic offline file; never customer evidence.','utf8');

export function requireEnk06SeedIdentity(target,identity,existing){
  if(target?.database!==DB||target.uat!==true||
      target.marker!==ENKYRON_ENK06_UAT_MARKER||
      identity?.database!==DB||
      identity.role!==ACTOR()||identity.owner!==identity.role||
      identity.port!=='5432'||identity.read_only!=='off')
    throw Error('Refusing ENK-06 seed: wrong UAT target, peer owner or session');
  if(!Array.isArray(existing)||existing.some(x=>x!==0)||existing.length!==6)
    throw Error('Refusing ENK-06 seed: database already contains business records');
}
export async function seedUat(){
  const target=resolveEnkyronDatabase();
  if(target.database!==DB||target.uat!==true||
      target.marker!==ENKYRON_ENK06_UAT_MARKER)
    throw Error('Refusing ENK-06 seed: dedicated UAT target is required');
  const pool=new pg.Pool({host:'/var/run/postgresql',port:5432,
    database:DB,user:ACTOR(),max:1,connectionTimeoutMillis:5000,
    options:'-c statement_timeout=30000 -c lock_timeout=3000'});
  try{
    await verifyEnkyronUatDatabase(pool,target);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      try{
        const ident=(await client.query(
          "SELECT current_database() AS database,current_user AS role,"+
          "pg_get_userbyid(datdba) AS owner,"+
          "current_setting('transaction_read_only') AS read_only,"+
          "current_setting('port') AS port "+
          "FROM pg_database WHERE datname=current_database()"
        )).rows[0];
        const count=(await client.query(
          'SELECT '+
          '(SELECT count(*)::int FROM enkyron_crm_companies) AS companies,'+
          '(SELECT count(*)::int FROM arl_workbench_tickets) AS tickets,'+
          '(SELECT count(*)::int FROM enkyron_crm_ticket_links) AS links,'+
          '(SELECT count(*)::int FROM enkyron_mail_local_threads) AS threads,'+
          '(SELECT count(*)::int FROM enkyron_mail_local_messages) AS messages,'+
          '(SELECT count(*)::int FROM enkyron_mail_attachment_quarantine) AS files'
        )).rows[0];
        requireEnk06SeedIdentity(target,ident,
          [count.companies,count.tickets,count.links,
            count.threads,count.messages,count.files]);
        const ids=SYNTHETIC_IDS,actor=ACTOR(),key='local:'+actor;
        const digest=createHash('sha256').update(BYTES).digest('hex');
        // Mirror the exact same schema/API used by ENK-06 PostgreSQL acceptance.
        await client.query(
          'INSERT INTO enkyron_crm_companies '+
          '(id,workspace_key,name,relationship_state,source_type,owner_local) '+
          "VALUES($1,$2,$3,'prospect','manual',$4)",
          [ids.company_id,key,NAME,actor]
        );
        await client.query(
          'INSERT INTO enkyron_crm_events '+
          '(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '+
          "VALUES('eeeeeeee-aaaa-4eee-8aaa-aaaaaaaaaaaa',$1,'company',$2,'created',$3)",
          [key,ids.company_id,actor]
        );
        await client.query(
          'INSERT INTO arl_workbench_tickets '+
          '(id,ticket_number,title,client_name,system_owner,target_kind,'+
          'target_reference,scope_text,assessor_name) '+
          "VALUES($1,$2,'ENK06 synthetic reviewed ticket',$3,"+
          "'UAT operator','other','synthetic:enk06',"+
          "'Synthetic acceptance only, not a customer assessment','UAT reviewer')",
          [ids.ticket_id,TICKET_NO,NAME]
        );
        await client.query(
          'INSERT INTO enkyron_crm_ticket_links '+
          '(id,workspace_key,company_id,ticket_id,ticket_client_name_at_review,'+
          'review_note,linked_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          ['aaaaaaaa-bbbb-4aaa-8bbb-bbbbbbbbbbbb',key,ids.company_id,
            ids.ticket_id,NAME,
            'UAT synthetic company-ticket membership reviewed explicitly.',actor]
        );
        await client.query(
          'INSERT INTO enkyron_crm_events '+
          '(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '+
          "VALUES('eeeeeeee-bbbb-4eee-8bbb-bbbbbbbbbbbb',$1,'company',$2,'linked',$3)",
          [key,ids.company_id,actor]
        );
        await client.query(
          'INSERT INTO enkyron_local_mail_access '+
          '(workspace_key,mailbox_key,role,can_read,can_send,granted_by) '+
          "VALUES($1,'direction','organization_owner_l5',true,false,$2),"+
          "($1,'support','organization_owner_l5',true,false,$2)",
          [key,actor]
        );
        await client.query(
          'INSERT INTO enkyron_mail_local_threads '+
          '(workspace_key,mailbox_key,thread_id,folder_key,subject,crm_company_id) '+
          "VALUES($1,'direction',$2,'inbox',$3,$4)",
          [key,ids.thread_id,SUBJECT,ids.company_id]
        );
        await client.query(
          'INSERT INTO enkyron_mail_local_messages '+
          '(workspace_key,mailbox_key,thread_id,message_id,'+
          'sender,recipients,subject,body_text,html_only,created_at) '+
          "VALUES($1,'direction',$2,$3,'synthetic@example.invalid',"+
          "'[]'::jsonb,$4,$5,false,NOW())",
          [key,ids.thread_id,ids.message_id,SUBJECT,
            'Synthetic email only. No real person or organization.']
        );
        await client.query(
          'INSERT INTO enkyron_mail_attachment_quarantine '+
          '(workspace_key,mailbox_key,message_id,attachment_id,original_filename,'+
          'content_bytes,content_sha256,safety_state,declared_size) '+
          "VALUES($1,'direction',$2,$3,$4,$5,$6,'quarantined_unscanned',$7)",
          [key,ids.message_id,ids.attachment_id,FILE,BYTES,digest,BYTES.length]
        );
        // No mail↔ticket or document↔dossier links are pre-created: the native
        // UAT dialog must create and verify these exact three references.
        await client.query('COMMIT');
        return {database:DB,seeded:true,synthetic_only:true,
          mailbox:'direction',ids,company:NAME,ticket_number:TICKET_NO,
          attachment:FILE,provider_unchanged:true};
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }
    }finally{client.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==3||process.argv[2]!=='--apply'){
    console.error('ENK-06 seed accepts only --apply on the separately created empty synthetic database');
    process.exitCode=2;
  }else seedUat().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{
      console.error('ENK-06 seed refused: '+String(error?.message||'unknown'));
      process.exitCode=1;
    });
}
