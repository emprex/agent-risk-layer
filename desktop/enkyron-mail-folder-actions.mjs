// Operator-led local folder triage for sent messages and unsent drafts.
// Resend submission records, provider state and append-only CRM events never change.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KEY=/^[a-z0-9_-]{1,64}$/;
const ACCOUNT=new Set(['direction','support']);
const SYSTEM=new Set(['inbox','sent','drafts','archive','spam','trash']);
const TARGET=new Set(['archive','spam','trash']);
function operatorScope(operator){
  if(typeof operator!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))
    throw Error('Invalid Mail operator');
  return 'local:'+operator;
}
function folderKey(v){
  if(typeof v!=='string'||!KEY.test(v))throw Error('Invalid Mail folder');
  return v;
}
function mailbox(v){if(!ACCOUNT.has(v))throw Error('Invalid Mail mailbox');return v;}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw Error('Invalid Mail record ID');return v;}
function kind(v){if(v!=='sent'&&v!=='drafts')throw Error('Invalid Mail record kind');return v;}
function selection(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Invalid Mail folder request');
  return {record_kind:kind(input.record_kind),record_id:uuid(input.record_id),
    mailbox_key:mailbox(input.mailbox_key)};
}
export function validateOutboundMove(input){
  const item=selection(input);
  if(input.confirmed!==true)throw Error('Mail filing requires operator confirmation');
  const from=folderKey(input.from_folder),to=folderKey(input.to_folder);
  if(from==='purged'||to==='purged'||from===to)
    throw Error('Invalid Mail destination');
  if(to==='inbox'||(SYSTEM.has(to)&&['sent','drafts'].includes(to)
    &&to!==item.record_kind))
    throw Error('Cannot file outbound mail in a different system mailbox');
  return {...item,from_folder:from,to_folder:to};
}
export function validateEmptyTrash(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    input.confirmed!==true)throw Error('Empty Trash requires explicit operator confirmation');
  const selected=input.mailbox??'all';
  if(selected!=='all')mailbox(selected);
  return {mailbox:selected};
}
async function tx(pool,action){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const out=await action(db);
    await db.query('COMMIT');
    return out;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
}
async function access(db,key,mailboxKey){
  const row=(await db.query(
    'SELECT can_read FROM enkyron_local_mail_access WHERE workspace_key=$1 '+
    "AND mailbox_key=$2 AND role='organization_owner_l5'",
    [key,mailboxKey]
  )).rows[0];
  if(row?.can_read!==true)throw Error('Mail read permission not granted');
}
async function requireDestination(db,key,to){
  if(SYSTEM.has(to))return;
  const row=(await db.query(
    'SELECT folder_key FROM enkyron_mail_local_folders '+
    'WHERE workspace_key=$1 AND folder_key=$2 FOR SHARE',[key,to]
  )).rows[0];
  if(!row)throw Error('Local Mail folder does not exist');
}
async function canonicalOutbound(db,key,item){
  const {record_kind,record_id,mailbox_key}=item;
  const sql=record_kind==='sent'
    ? 'SELECT id,mailbox_key FROM enkyron_mail_send_attempts '+
      'WHERE workspace_key=$1 AND id=$2 FOR UPDATE'
    : 'SELECT d.id,d.mailbox_key FROM enkyron_crm_mail_drafts d '+
      'WHERE d.workspace_key=$1 AND d.id=$2 '+
      'AND NOT EXISTS (SELECT 1 FROM enkyron_mail_send_attempts s '+
      'WHERE s.workspace_key=d.workspace_key AND s.draft_id=d.id) '+
      'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_mail_manual_sends m '+
      'WHERE m.workspace_key=d.workspace_key AND m.draft_id=d.id) FOR UPDATE';
  const found=(await db.query(sql,[key,record_id])).rows[0];
  if(!found||found.mailbox_key!==mailbox_key)
    throw Error('Outbound message missing or no longer an unsent draft');
}
export async function moveOutboundMail(pool,operator,input,{uuidFactory=randomUUID}={}){
  const key=operatorScope(operator),req=validateOutboundMove(input);
  return tx(pool,async db=>{
    await access(db,key,req.mailbox_key);
    await canonicalOutbound(db,key,req);
    const prior=(await db.query(
      'SELECT folder_key,previous_folder,revision FROM enkyron_mail_outbound_locations '+
      'WHERE workspace_key=$1 AND record_kind=$2 AND record_id=$3 FOR UPDATE',
      [key,req.record_kind,req.record_id]
    )).rows[0];
    const base=req.record_kind;
    const before=prior?.folder_key??base;
    if(before!==req.from_folder)throw Error('Mail folder changed; refresh before moving');
    let destination=req.to_folder;
    if(destination==='previous'){
      if(before!=='trash'||!prior)throw Error('Only trashed mail can be restored');
      destination=prior.previous_folder||base;
    }
    if(destination===before||destination==='purged'||destination==='inbox'||
       (['sent','drafts'].includes(destination)&&destination!==base))
      throw Error('Invalid Mail destination');
    await requireDestination(db,key,destination);
    const previous=destination==='trash'?before:(prior?.previous_folder??base);
    await db.query(
      'INSERT INTO enkyron_mail_outbound_locations '+
      '(workspace_key,record_kind,record_id,mailbox_key,folder_key,previous_folder) '+
      'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_key,record_kind,record_id) '+
      'DO UPDATE SET folder_key=EXCLUDED.folder_key,previous_folder=EXCLUDED.previous_folder, '+
      'revision=enkyron_mail_outbound_locations.revision+1,updated_at=NOW()',
      [key,req.record_kind,req.record_id,req.mailbox_key,destination,previous]
    );
    await db.query(
      'INSERT INTO enkyron_mail_folder_events '+
      '(id,workspace_key,record_kind,record_id,mailbox_key,event_kind,detail,actor_local) '+
      "VALUES($1,$2,$3,$4,$5,'outbound_moved',$6::jsonb,$7)",
      [uuidFactory(),key,req.record_kind,req.record_id,req.mailbox_key,
        JSON.stringify({from:before,to:destination}),operator]
    );
    return {moved:true,record_kind:req.record_kind,record_id:req.record_id,
      folder:destination,provider_unchanged:true,canonical_history_retained:true};
  });
}

export async function listMovedOutboundMail(pool,operator,input={}){
  const key=operatorScope(operator),folder=folderKey(input.folder||'trash');
  const chosen=input.mailbox||'all';
  if(chosen!=='all')mailbox(chosen);
  if(['sent','drafts','purged'].includes(folder))
    throw Error('Use the normal Sent/Drafts view or audited trash purge');
  const search=String(input.search||'').trim();
  if(search.length>120||/[\x00-\x1f\x7f]/.test(search))
    throw Error('Invalid Mail search');
  const params=[key,folder,chosen,search];
  // Filings are local metadata only. The original sent attempt/draft is never deleted.
  const sent=(await pool.query(
    'SELECT l.record_id AS id,l.record_kind,l.mailbox_key,l.previous_folder,'+
    's.draft_id,d.recipient_email,d.subject,s.outcome,s.recorded_at AS updated_at '+
    'FROM enkyron_mail_outbound_locations l '+
    'JOIN enkyron_mail_send_attempts s ON s.workspace_key=l.workspace_key '+
    "AND s.id::text=l.record_id AND l.record_kind='sent' "+
    'JOIN enkyron_crm_mail_drafts d ON d.workspace_key=s.workspace_key AND d.id=s.draft_id '+
    "WHERE l.workspace_key=$1 AND ($2='all' OR l.folder_key=$2) "+
    "AND l.folder_key<>'purged' "+
    "AND EXISTS (SELECT 1 FROM enkyron_local_mail_access access "+
    "WHERE access.workspace_key=l.workspace_key AND access.mailbox_key=l.mailbox_key "+
    "AND access.role='organization_owner_l5' AND access.can_read=TRUE) "+
    "AND ($3='all' OR l.mailbox_key=$3) "+
    "AND ($4='' OR POSITION(lower($4) IN lower(d.subject))>0 "+
    'OR POSITION(lower($4) IN lower(coalesce(d.recipient_email,\'\')))>0) '+
    'ORDER BY l.updated_at DESC LIMIT 101',params)).rows;
  const drafts=(await pool.query(
    'SELECT l.record_id AS id,l.record_kind,l.mailbox_key,l.previous_folder,'+
    'd.id AS draft_id,d.recipient_email,d.subject,NULL::text AS outcome,'+
    'd.updated_at FROM enkyron_mail_outbound_locations l '+
    'JOIN enkyron_crm_mail_drafts d ON d.workspace_key=l.workspace_key '+
    "AND d.id=l.record_id AND l.record_kind='drafts' "+
    "WHERE l.workspace_key=$1 AND ($2='all' OR l.folder_key=$2) "+
    "AND l.folder_key<>'purged' "+
    "AND EXISTS (SELECT 1 FROM enkyron_local_mail_access access "+
    "WHERE access.workspace_key=l.workspace_key AND access.mailbox_key=l.mailbox_key "+
    "AND access.role='organization_owner_l5' AND access.can_read=TRUE) "+
    "AND ($3='all' OR l.mailbox_key=$3) "+
    'AND NOT EXISTS (SELECT 1 FROM enkyron_mail_send_attempts s '+
    'WHERE s.workspace_key=d.workspace_key AND s.draft_id=d.id) '+
    'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_mail_manual_sends m '+
    'WHERE m.workspace_key=d.workspace_key AND m.draft_id=d.id) '+
    "AND ($4='' OR POSITION(lower($4) IN lower(d.subject))>0 "+
    'OR POSITION(lower($4) IN lower(coalesce(d.recipient_email,\'\')))>0) '+
    'ORDER BY l.updated_at DESC LIMIT 101',params)).rows;
  const combined=[...sent,...drafts].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
  return {available:true,items:combined.slice(0,200),more:sent.length>100||drafts.length>100,
    folder,provider_unchanged:true};
}

// "Empty Trash" removes items from ALL visible local folders. It is not
// a provider-side delete or a claim of legal erasure of immutable audit records.
export async function emptyLocalTrash(pool,operator,input,{uuidFactory=randomUUID}={}){
  const key=operatorScope(operator),req=validateEmptyTrash(input);
  return tx(pool,async db=>{
    for(const account of (req.mailbox==='all'?['direction','support']:[req.mailbox]))
      await access(db,key,account);
    const inbound=await db.query(
      "UPDATE enkyron_mail_local_threads SET folder_key='purged' "+
      "WHERE workspace_key=$1 AND folder_key='trash' "+
      "AND ($2='all' OR mailbox_key=$2) RETURNING thread_id",
      [key,req.mailbox]
    );
    const outbound=await db.query(
      "UPDATE enkyron_mail_outbound_locations SET folder_key='purged', "+
      "revision=revision+1,updated_at=NOW() WHERE workspace_key=$1 "+
      "AND folder_key='trash' AND ($2='all' OR mailbox_key=$2) RETURNING record_id",
      [key,req.mailbox]
    );
    const inboundCount=inbound.rowCount??inbound.rows.length;
    const outboundCount=outbound.rowCount??outbound.rows.length;
    await db.query(
      'INSERT INTO enkyron_mail_folder_events '+
      '(id,workspace_key,event_kind,detail,actor_local) '+
      "VALUES($1,$2,'trash_emptied',$3::jsonb,$4)",
      [uuidFactory(),key,JSON.stringify({mailbox:req.mailbox,
        inbound_count:inboundCount,outbound_count:outboundCount,
        local_views_only:true,audit_retained:true}),operator]
    );
    return {emptied:true,inbound_count:inboundCount,outbound_count:outboundCount,
      removed_from_views:inboundCount+outboundCount,provider_unchanged:true,
      audit_retained:true,local_content_not_erased:true};
  });
}
