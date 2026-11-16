// Read-only list of real locally quarantined mail attachments.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function listMailDocumentCandidates(pool,actor,input){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor)
     ||!input||!['direction','support'].includes(input.mailbox)
     ||typeof input.thread_id!=='string'||!UUID.test(input.thread_id))
    throw Error('Invalid Mail document lookup');

  const key='local:'+actor;

  const permission=(await pool.query(
    'SELECT can_read FROM enkyron_local_mail_access '+
    "WHERE workspace_key=$1 AND mailbox_key=$2 "+
    "AND role='organization_owner_l5'",
    [key,input.mailbox]
  )).rows[0];

  if(permission?.can_read!==true)
    throw Error('Mailbox document access denied');

  const ready=(await pool.query(
    "SELECT to_regclass('enkyron_mail_attachment_quarantine') "+
    "IS NOT NULL AS available"
  )).rows[0]?.available===true;

  if(!ready)
    return {available:false,items:[],
      notice:'Local Mail attachment archive is unavailable'};

  const rows=(await pool.query(
    'SELECT q.message_id,q.attachment_id,q.original_filename AS filename,'+
    'q.declared_size AS size,q.safety_state,'+
    '(q.content_bytes IS NOT NULL) AS stored,'+
    'q.content_sha256 '+
    'FROM enkyron_mail_attachment_quarantine q '+
    'JOIN enkyron_mail_local_messages m '+
    'ON m.workspace_key=q.workspace_key '+
    'AND m.mailbox_key=q.mailbox_key '+
    'AND m.message_id=q.message_id '+
    'WHERE q.workspace_key=$1 AND q.mailbox_key=$2 '+
    'AND m.thread_id=$3 '+
    'ORDER BY m.created_at,q.original_filename,q.attachment_id '+
    'LIMIT 101',
    [key,input.mailbox,input.thread_id]
  )).rows;

  return {
    available:true,
    items:rows.slice(0,100).map(row=>({
      message_id:row.message_id,
      attachment_id:row.attachment_id,
      filename:row.filename,
      size:row.size,
      stored:row.stored===true,
      safety_state:row.safety_state,
      ready:row.stored===true &&
        row.safety_state==='quarantined_unscanned' &&
        /^[a-f0-9]{64}$/.test(row.content_sha256||'')
    })),
    more:rows.length>100
  };
}
