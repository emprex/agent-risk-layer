
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
import {quarantineAttachmentBytes} from './enkyron-mail-archive.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX=26214400;

function validate(input,write=false) {
  if (!input || !['direction','support'].includes(input.mailbox)
      || !UUID.test(input.thread_id||'')
      || (write && (!UUID.test(input.message_id||'')
          || !UUID.test(input.attachment_id||'')
          || input.confirmed!==true)))
    throw Error('Invalid attachment selection');
}

async function records(pool,actor,input,exact=false) {
  validate(input,exact);
  const params=['local:'+actor,input.mailbox,input.thread_id];
  if (exact) params.push(input.message_id,input.attachment_id);
  const result=await pool.query(
    'SELECT q.message_id::text AS message_id,'+
    'q.attachment_id::text AS attachment_id,'+
    'q.original_filename AS filename,q.declared_size AS size,'+
    'q.safety_state AS state '+
    'FROM enkyron_mail_attachment_quarantine q '+
    'JOIN enkyron_mail_local_messages m '+
    'ON m.workspace_key=q.workspace_key '+
    'AND m.mailbox_key=q.mailbox_key AND m.message_id=q.message_id '+
    'JOIN enkyron_local_mail_access a '+
    'ON a.workspace_key=q.workspace_key AND a.mailbox_key=q.mailbox_key '+
    "AND a.role='organization_owner_l5' AND a.can_read=true "+
    'WHERE q.workspace_key=$1 AND q.mailbox_key=$2 '+
    'AND m.thread_id=$3 '+
    (exact?'AND q.message_id=$4 AND q.attachment_id=$5 ':'')+
    'ORDER BY q.message_id,q.attachment_id LIMIT 51',
    params
  );
  return result.rows;
}

export async function listAttachmentOptions(pool,actor,input) {
  const list=await records(pool,actor,input);
  return {available:true,mailbox:input.mailbox,
    thread_id:input.thread_id,items:list.slice(0,50),
    more:list.length>50};
}

async function get(url,token) {
  const response=await fetch(url,{
    method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(12000)
  });
  if (!response.ok)
    throw Error('Resend lookup HTTP '+response.status);
  const body=await response.json();
  return body?.data??body;
}

function approvedURL(value) {
  const url=new URL(value);
  const h=url.hostname.toLowerCase();
  const allowed=['resend.com','resendcdn.com','amazonaws.com',
    'cloudfront.net','r2.cloudflarestorage.com'];
  if (url.protocol!=='https:' || url.username || url.password
      || (url.port && url.port!=='443')
      || !(h==='cdn.resend.app' || allowed.some(d=>h===d||h.endsWith('.'+d))))
    throw Error('Unapproved signed attachment host');
  return url;
}

async function download(url,size) {
  const response=await fetch(approvedURL(url),{
    method:'GET',redirect:'error',
    signal:AbortSignal.timeout(30000)
  });
  if (!response.ok || !response.body)
    throw Error('Attachment download unavailable');

  const length=response.headers.get('content-length');
  if (length!==null &&
      (!/^\d+$/.test(length) || Number(length)>MAX))
    throw Error('Attachment size limit exceeded');

  const reader=response.body.getReader();
  const parts=[];
  let count=0;
  try {
    while (true) {
      const {value,done}=await reader.read();
      if (done) break;
      count+=value.byteLength;
      if (count>size || count>MAX)
        throw Error('Attachment exceeds declared size');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(()=>{});
  }
  if (count!==size)
    throw Error('Attachment size mismatch');
  return Buffer.concat(parts,count);
}

export async function retrieveAttachmentToQuarantine(pool,actor,input) {
  validate(input,true);
  const list=await records(pool,actor,input,true);
  if (list.length!==1)
    throw Error('Attachment reference not accessible');

  const item=list[0];
  if (item.state!=='metadata_only')
    throw Error('Attachment is not eligible for retrieval');

  const size=Number(item.size);
  if (!Number.isSafeInteger(size)||size<0||size>MAX)
    throw Error('Invalid declared size');

  const cfg=await loadPrivateResendConfig();
  const token=await cfg.credentialProvider();
  const base='https://api.resend.com/emails/receiving/';

  const email=await get(base+item.message_id,token);
  if (email?.id!==item.message_id)
    throw Error('Provider email identity mismatch');

  const attachment=await get(
    base+item.message_id+'/attachments/'+item.attachment_id,token
  );
  if (attachment?.id!==item.attachment_id
      || (attachment.size!=null && Number(attachment.size)!==size))
    throw Error('Provider attachment mismatch');

  const bytes=await download(attachment.download_url,size);
  const current=await records(pool,actor,input,true);
  if (current.length!==1 || current[0].state!=='metadata_only'
      || Number(current[0].size)!==size)
    throw Error('Attachment manifest changed');

  const saved=await quarantineAttachmentBytes(pool,actor,{
    mailbox:input.mailbox,
    message_id:item.message_id,
    attachment_id:item.attachment_id,
    bytes
  });

  return {...saved,safety_state:'quarantined_unscanned',
    notice:'Stored in quarantine; NOT scanned or released.'};
}


// Explicit read-only preview. No database mutation or file execution.
export async function previewTextAttachment(pool, actor, input) {
  let phase = 'input';
  try {
  validate(input, true);

  phase = 'manifest';
  const list = await records(pool, actor, input, true);
  if (list.length !== 1)
    throw Error('Attachment is not accessible');

  const item = list[0];
  const filename = String(item.filename || '');

  if (!/\.(md|txt)$/i.test(filename))
    throw Error('This preview supports Markdown and plain text only');

  if (!['metadata_only','quarantined_unscanned'].includes(item.state))
    throw Error('Attachment cannot be opened');

  const size = Number(item.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > 1048576)
    throw Error('Text preview exceeds the 1 MB limit');

  phase = 'credentials';
  const cfg = await loadPrivateResendConfig();
  const token = await cfg.credentialProvider();
  const base = 'https://api.resend.com/emails/receiving/';

  phase = 'provider-email';
  const email = await get(base + item.message_id, token);
  if (email?.id !== item.message_id)
    throw Error('Email identity mismatch');

  phase = 'provider-attachment';
  const attachment = await get(
    base + item.message_id + '/attachments/' + item.attachment_id,
    token
  );

  if (attachment?.id !== item.attachment_id ||
      Number(attachment.size) !== size)
    throw Error('Attachment identity mismatch');

  phase = 'download';
  const bytes = await download(attachment.download_url, size);
  if (bytes.includes(0))
    throw Error('Binary content cannot be displayed as text');

  phase = 'decode';
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);

  return {
    available:true,
    mailbox:input.mailbox,
    thread_id:input.thread_id,
    attachment_id:item.attachment_id,
    filename,
    size,
    text
  };
  } catch (error) {
    const msg=String(error?.message || '');
    const code=msg.includes('Unapproved signed attachment host')
      ? 'SIGNED_HOST_NOT_ALLOWED' :
      msg.includes('Attachment identity mismatch')
      ? 'PROVIDER_IDENTITY_MISMATCH' :
      msg.includes('Attachment size mismatch')
      ? 'SIZE_MISMATCH' :
      msg.includes('Text preview exceeds')
      ? 'SIZE_LIMIT' :
      msg.includes('Binary content')
      ? 'NOT_TEXT' :
      msg.includes('encoded') || msg.includes('UTF-8')
      ? 'NOT_UTF8' : phase.toUpperCase().replaceAll('-', '_') + '_FAILED';
    return {available:false,code};
  }
}


// M05-C: operator-requested, bounded PDF/image preview.
// Reuses exact Resend message and attachment verification.
// Never executes attachment content or changes PostgreSQL.

export function binaryAttachmentFormat(filename, bytes) {
  if (!Buffer.isBuffer(bytes))
    throw Error('Invalid attachment bytes');

  const ext = typeof filename === 'string'
    ? filename.toLowerCase().split('.').at(-1) : '';

  if (ext === 'pdf' &&
      bytes.subarray(0,5).toString('ascii') === '%PDF-')
    return 'pdf';

  if (ext === 'png' &&
      bytes.subarray(0,8).equals(
        Buffer.from([137,80,78,71,13,10,26,10])))
    return 'png';

  if ((ext === 'jpg' || ext === 'jpeg') &&
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff)
    return 'jpeg';

  throw Error('Unsupported or mismatched binary attachment');
}

export async function previewBinaryAttachment(pool,actor,input) {
  try {
    validate(input,true);

    const rows = await records(pool,actor,input,true);
    if (rows.length !== 1)
      throw Error('Attachment reference unavailable');

    const item = rows[0];
    const filename = String(item.filename || '');

    if (!/\.(pdf|png|jpe?g)$/i.test(filename))
      throw Error('Unsupported binary file');

    if (!['metadata_only','quarantined_unscanned']
        .includes(item.state))
      throw Error('Attachment is blocked');

    const size = Number(item.size);

    if (!Number.isSafeInteger(size) ||
        size < 4 || size > 10485760)
      throw Error('Binary preview limit exceeded');

    const cfg = await loadPrivateResendConfig();
    const token = await cfg.credentialProvider();
    const base = 'https://api.resend.com/emails/receiving/';

    const email = await get(base + item.message_id,token);
    if (email?.id !== item.message_id)
      throw Error('Resend email identity mismatch');

    const attachment = await get(
      base + item.message_id +
      '/attachments/' + item.attachment_id,token
    );

    if (attachment?.id !== item.attachment_id ||
        Number(attachment.size) !== size)
      throw Error('Resend attachment identity mismatch');

    const bytes = await download(attachment.download_url,size);
    const format = binaryAttachmentFormat(filename,bytes);

    return {
      available:true,
      mailbox:input.mailbox,
      thread_id:input.thread_id,
      attachment_id:item.attachment_id,
      filename,
      size,
      format,
      content_base64:bytes.toString('base64')
    };

  } catch(error) {
    const description = String(error?.message || '');

    const code = description.includes('signed attachment host')
      ? 'HOST_BLOCKED'
      : description.includes('identity mismatch')
      ? 'IDENTITY_MISMATCH'
      : description.includes('mismatched binary')
      ? 'FORMAT_MISMATCH'
      : description.includes('limit exceeded')
      ? 'SIZE_LIMIT'
      : 'DOWNLOAD_FAILED';

    return {available:false,code};
  }
}
