// E04-05 / E04-06A: independent PostgreSQL archive within NEMORYTH.
// Resend remains transport; its HTML/attachments are NEVER executed or sent
// directly to Qt, and attachment bytes are never available to the operator
// until a separate, approved quarantine scanner and release gate exists.
import {createHash} from 'node:crypto';
import {mailEmailDetails} from './enkyron-mail-service.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid Mail operator');
  return 'local:'+actor;
}
function uuid(id){
  if(typeof id!=='string'||!UUID.test(id))throw Error('Invalid Mail identifier');
  return id;
}
function mailboxName(value){
  if(!['direction','support'].includes(value))throw Error('Invalid Mail mailbox');
  return value;
}
function boundedText(value,max=2097152){
  if(value===null||value===undefined)return null;
  if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>max)
    throw Error('Archived content exceeds size limit');
  return value;
}
function recipients(value){
  if(!Array.isArray(value)||value.length>100
      ||value.some(x=>typeof x!=='string'||Buffer.byteLength(x,'utf8')>2048))
    throw Error('Malformed provider recipient list');
  return JSON.stringify(value);
}
export async function archiveSchemaReady(pool){
  const row=(await pool.query(
    "SELECT to_regclass('enkyron_mail_full_messages') IS NOT NULL AS full, "+
    "to_regclass('enkyron_mail_attachment_quarantine') IS NOT NULL AS attachments"
  )).rows[0];
  return row?.full===true&&row?.attachments===true;
}

export async function archiveNextMailBatch(pool,actor,input={},{
  getDetails=mailEmailDetails
}={}){
  const workspace=scope(actor);
  if(input&&typeof input==='object'&&input.mailbox!==undefined
      &&input.mailbox!=='all')mailboxName(input.mailbox);
  if(!(await archiveSchemaReady(pool)))
    return {available:false,archived:0,incomplete:0,failed:0,
      note:'Mail archive schema 113 not applied. Existing Inbox is unchanged.'};
  const selected=input?.mailbox||'all';
  // Small pages keep Resend GET calls bounded under native IPC timeouts.
  const candidates=(await pool.query(
    'SELECT m.mailbox_key,m.thread_id,m.message_id FROM enkyron_mail_local_messages m '+
    'LEFT JOIN enkyron_mail_full_messages a ON a.workspace_key=m.workspace_key '+
    'AND a.mailbox_key=m.mailbox_key AND a.message_id=m.message_id '+
    'WHERE m.workspace_key=$1 AND ($2::text=\'all\' OR m.mailbox_key=$2) '+
    'AND a.message_id IS NULL '+
    'ORDER BY m.cached_at ASC,m.mailbox_key,m.message_id LIMIT 4',
    [workspace,selected]
  )).rows;
  let archived=0,incomplete=0,failed=0,metadata=0;
  for(const row of candidates){
    let detail;
    try{
      detail=await getDetails(pool,actor,row.mailbox_key,
        String(row.thread_id),String(row.message_id));
      if(!detail||detail.id!==String(row.message_id)
          ||detail.mailbox!==row.mailbox_key
          ||detail.thread_id!==String(row.thread_id))
        throw Error('Provider archive message identity mismatch');
      const fullText=boundedText(detail.text);
      const fullHtml=boundedText(detail.html);
      const state=(detail.text===undefined&&detail.html===undefined)
          ||detail.attachments_known===false
        ?'incomplete':'complete';
      const list=Array.isArray(detail.attachments)?detail.attachments:[];
      if(list.length>100)throw Error('Archive attachment count exceeded');
      const seen=new Set();
      for(const item of list){
        uuid(item.id);
        if(seen.has(item.id))throw Error('Duplicate provider attachment');
        seen.add(item.id);
        boundedText(item.filename||'',512);
        boundedText(item.content_type||'',256);
        if(item.size!==null&&item.size!==undefined
            &&(!Number.isSafeInteger(item.size)||item.size<0||item.size>26214400))
          throw Error('Unsafe provider attachment size');
      }
      const sha=createHash('sha256').update(JSON.stringify([
        row.mailbox_key,String(row.message_id),detail.rfc_message_id||'',
        fullText,fullHtml,detail.from,detail.to,detail.cc,detail.bcc,detail.reply_to
      ])).digest('hex');
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const saved=await client.query(
          'INSERT INTO enkyron_mail_full_messages '+
          '(workspace_key,mailbox_key,thread_id,message_id,rfc_message_id,'+
          'direction,sender,recipients,cc,bcc,reply_to,body_text_full,'+
          'body_html_inert,provider_sha256,archive_state) '+
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'+
          '$11::jsonb,$12,$13,$14,$15) '+
          'ON CONFLICT(workspace_key,mailbox_key,message_id) DO NOTHING',
          [workspace,row.mailbox_key,row.thread_id,row.message_id,
            boundedText(detail.rfc_message_id||'',998),
            ['inbound','outbound'].includes(detail.direction)
              ?detail.direction:'unknown',
            boundedText(detail.from||'',2048),
            recipients(detail.to||[]),recipients(detail.cc||[]),
            recipients(detail.bcc||[]),recipients(detail.reply_to||[]),
            fullText,fullHtml,sha,state]
        );
        for(const item of list){
          await client.query(
            'INSERT INTO enkyron_mail_attachment_quarantine '+
            '(workspace_key,mailbox_key,message_id,attachment_id,'+
            'original_filename,content_type,declared_size,safety_state) '+
            "VALUES($1,$2,$3,$4,$5,$6,$7,'metadata_only') "+
            'ON CONFLICT(workspace_key,mailbox_key,message_id,attachment_id) DO NOTHING',
            [workspace,row.mailbox_key,row.message_id,item.id,
              item.filename||'',item.content_type||'',item.size??null]
          );
        }
        await client.query('COMMIT');
        if(saved.rowCount){
          if(state==='complete')archived++;
          else incomplete++;
          metadata+=list.length;
        }
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    }catch{
      // Per-message failure never fabricates archived=true or deletes a
      // previously cached short body. The next explicitly bounded run retries.
      failed++;
    }
  }
  return {available:true,archived,incomplete,failed,attachments_metadata:metadata,
    more_pending:candidates.length===4,
    note:'Full content stored inert. Attachments metadata quarantined; bytes not yet retrieved or released.'};
}

// Status only: neither HTML nor attachment bytes may exit this IPC boundary.
export async function mailArchiveStatus(pool,actor,input={}){
  const workspace=scope(actor),selected=input?.mailbox||'all';
  if(selected!=='all')mailboxName(selected);
  if(!(await archiveSchemaReady(pool)))return {available:false};
  const row=(await pool.query(
    'SELECT (SELECT count(*)::int FROM enkyron_mail_local_messages m '+
    'WHERE m.workspace_key=$1 AND ($2::text=\'all\' OR m.mailbox_key=$2)) AS cached,'+
    '(SELECT count(*)::int FROM enkyron_mail_full_messages f '+
    'WHERE f.workspace_key=$1 AND ($2::text=\'all\' OR f.mailbox_key=$2) '+
    "AND f.archive_state='complete') AS complete,"+
    '(SELECT count(*)::int FROM enkyron_mail_full_messages f '+
    'WHERE f.workspace_key=$1 AND ($2::text=\'all\' OR f.mailbox_key=$2) '+
    "AND f.archive_state='incomplete') AS incomplete,"+
    '(SELECT count(*)::int FROM enkyron_mail_attachment_quarantine q '+
    'WHERE q.workspace_key=$1 AND ($2::text=\'all\' OR q.mailbox_key=$2)) '+
    'AS quarantined_metadata',
    [workspace,selected]
  )).rows[0];
  return {available:true,...row,
    note:'Attachment metadata is not an archived attachment; scanner approval required.'};
}
