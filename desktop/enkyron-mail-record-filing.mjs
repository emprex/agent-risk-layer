// ENKYRON local-only filing for saved drafts and sent records.
// No provider deletion, no change to immutable send/audit history.
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const FOLDERS=['sent','drafts','archive','spam','trash'];
function actorKey(actor){if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))throw Error('Invalid Mail operator');return 'local:'+actor;}
function requireId(id){if(typeof id!=='string'||!UUID.test(id))throw Error('Invalid Mail draft identifier');return id;}
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
export function validateRecordMove(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['draft_id','from','to','confirmed'].includes(k))||input.confirmed!==true)throw Error('Mail move confirmation required');
 const draft_id=requireId(input.draft_id);
 if(!FOLDERS.includes(input.from)||!FOLDERS.includes(input.to)||input.from===input.to)throw Error('Invalid Mail move');
 return {draft_id,from:input.from,to:input.to};
}
export async function moveSavedMailRecord(pool,actor,input){
 const key=actorKey(actor),req=validateRecordMove(input);
 return tx(pool,async c=>{
   const d=(await c.query('SELECT id FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2 FOR UPDATE',[key,req.draft_id])).rows[0];
   if(!d)throw Error('Mail record not in this workspace');
   const sent=(await c.query('SELECT (EXISTS (SELECT 1 FROM enkyron_mail_send_attempts a WHERE a.workspace_key=$1 AND a.draft_id=$2) OR EXISTS (SELECT 1 FROM enkyron_crm_mail_manual_sends s WHERE s.workspace_key=$1 AND s.draft_id=$2)) AS sent',[key,req.draft_id])).rows[0]?.sent===true;
   const original=sent?'sent':'drafts';
   const saved=(await c.query('SELECT folder_key FROM enkyron_mail_record_filing WHERE workspace_key=$1 AND draft_id=$2 FOR UPDATE',[key,req.draft_id])).rows[0];
   if((saved?.folder_key||original)!==req.from)throw Error('Mail folder changed; refresh first');
   if((req.to==='sent'&&!sent)||(req.to==='drafts'&&sent))throw Error('Cannot change an email send state by moving folders');
   await c.query('INSERT INTO enkyron_mail_record_filing(workspace_key,draft_id,folder_key,previous_folder) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_key,draft_id) DO UPDATE SET folder_key=EXCLUDED.folder_key,previous_folder=EXCLUDED.previous_folder,updated_at=NOW()',[key,req.draft_id,req.to,req.to==='trash'?req.from:null]);
   await c.query("INSERT INTO enkyron_mail_filing_events(event_id,workspace_key,draft_id,operation,details,actor_local) VALUES($1,$2,$3,'move',$4::jsonb,$5)",[randomUUID(),key,req.draft_id,JSON.stringify({from:req.from,to:req.to}),actor]);
   return {moved:true,folder:req.to,draft_id:req.draft_id,provider_unchanged:true};
 });
}
export async function listTrashedSavedMail(pool,actor,input={}){
 const key=actorKey(actor),mailbox=input.mailbox??'all';
 if(!['all','direction','support'].includes(mailbox))throw Error('Invalid Mail mailbox');
 const rows=(await pool.query('SELECT d.id AS draft_id,d.mailbox_key,d.recipient_email,d.subject,d.updated_at,CASE WHEN EXISTS (SELECT 1 FROM enkyron_mail_send_attempts a WHERE a.workspace_key=d.workspace_key AND a.draft_id=d.id) OR EXISTS (SELECT 1 FROM enkyron_crm_mail_manual_sends s WHERE s.workspace_key=d.workspace_key AND s.draft_id=d.id) THEN \'sent\' ELSE \'drafts\' END AS original_kind FROM enkyron_mail_record_filing f JOIN enkyron_crm_mail_drafts d ON d.workspace_key=f.workspace_key AND d.id=f.draft_id WHERE f.workspace_key=$1 AND f.folder_key=\'trash\' AND ($2=\'all\' OR d.mailbox_key=$2) ORDER BY f.updated_at DESC LIMIT 101',[key,mailbox])).rows;
 return {items:rows.slice(0,100),more:rows.length>100};
}
export async function clearTrashedLocalMail(pool,actor,input){
 const key=actorKey(actor);
 if(!input||input.confirmed!==true||Object.keys(input).some(k=>k!=='confirmed'))throw Error('Explicit Trash clearance confirmation required');
 return tx(pool,async c=>{
  const records=await c.query("UPDATE enkyron_mail_record_filing SET folder_key='hidden',updated_at=NOW() WHERE workspace_key=$1 AND folder_key='trash' RETURNING draft_id",[key]);
  const threads=await c.query("UPDATE enkyron_mail_local_threads SET folder_key='hidden' WHERE workspace_key=$1 AND folder_key='trash' RETURNING thread_id",[key]);
  const count=(result)=>result.rowCount??result.rows.length;
  await c.query("INSERT INTO enkyron_mail_filing_events(event_id,workspace_key,operation,details,actor_local) VALUES($1,$2,'clear_trash',$3::jsonb,$4)",[randomUUID(),key,JSON.stringify({saved_records:count(records),cached_threads:count(threads)}),actor]);
  return {cleared:true,records:count(records),threads:count(threads),provider_unchanged:true,audit_retained:true};
 });
}
