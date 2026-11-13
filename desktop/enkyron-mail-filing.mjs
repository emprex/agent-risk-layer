// ENKYRON Mail: explicit provider folder moves with append-only local audit.
// Never delete permanently, never send mail, never accept an arbitrary URL.
import {randomUUID} from 'node:crypto';
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const FOLDERS=new Set(['inbox','archive','spam','trash']);
const MAILBOXES=new Set(['direction','support']);
export function validateFiling(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     !MAILBOXES.has(input.mailbox)||!UUID.test(input.thread_id||'')||
     !FOLDERS.has(input.from_folder)||!FOLDERS.has(input.to_folder)||
     input.from_folder===input.to_folder||input.confirmed!==true)
    throw new Error('Mail folder change requires a selected thread and confirmation');
  return {mailbox:input.mailbox,threadId:input.thread_id,
    source:input.from_folder,target:input.to_folder};
}
export async function moveMailThread(pool,operator,input,{
  fetchImpl=globalThis.fetch,credentialsLoader=loadPrivateResendConfig,
  uuid=randomUUID
}={}){
  const {mailbox,threadId,source,target}=validateFiling(input);
  if(typeof operator!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))
    throw new Error('Invalid local mail operator');
  const scope='local:'+operator;
  const rights=(await pool.query(
    'SELECT can_manage FROM enkyron_local_mail_access '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 AND role=$3',
    [scope,mailbox,'organization_owner_l5']
  )).rows[0];
  if(rights?.can_manage!==true)
    throw new Error('Mailbox filing permission is not provisioned');
  // Verify thread is actually in the source folder before recording intent.
  const config=await credentialsLoader(),inbox=config.mailboxes?.[mailbox];
  if(!UUID.test(inbox||''))throw new Error('Mail provider inbox is not configured');
  const token=await config.credentialProvider();
  if(typeof token!=='string'||!token.trim())throw new Error('Mail credentials unavailable');
  const base='https://api.resend.com/inboxes/'+inbox+'/threads/'+threadId;
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  // No automatic retry. A failed GET cannot authorise a state change.
  let prior;
  try{prior=await fetchImpl(base,{method:'GET',headers,redirect:'error',
    signal:AbortSignal.timeout(12000)});}catch{
    throw new Error('Cannot verify provider thread state; no move attempted');
  }
  if(!prior?.ok)throw new Error('Cannot read provider thread; no move attempted');
  let record;
  try{record=await prior.json();}catch{throw new Error('Invalid provider thread response');}
  if(record?.id!==threadId||record?.folder!==source)
    throw new Error('Provider folder changed; refresh before filing');

  const operationId=uuid();
  async function audit(kind){
    await pool.query(
      'INSERT INTO enkyron_mail_filing_events '+
      '(id,operation_id,workspace_key,mailbox_key,thread_id,source_folder,'+
      'target_folder,event_kind,actor_local) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(),operationId,scope,mailbox,threadId,source,target,kind,operator]
    );
  }
  await audit('requested'); // Before the provider mutation.
  let acknowledged=false;
  try{
    const response=await fetchImpl(base,{
      method:'PATCH',headers,redirect:'error',signal:AbortSignal.timeout(12000),
      body:JSON.stringify({folder:target})
    });
    acknowledged=response?.ok===true;
  }catch{
    // Outcome uncertain. Never auto retry when provider might have moved it.
  }
  await audit(acknowledged?'provider_confirmed':'provider_uncertain');
  if(!acknowledged)
    return {moved:false,uncertain:true,notice:'Provider outcome uncertain. Refresh the folder before any retry.'};
  // Cache follows the provider-acknowledged state; audit remains authoritative.
  await pool.query(
    'UPDATE enkyron_mail_thread_index SET folder=$4,indexed_at=NOW() '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3',
    [scope,mailbox,threadId,target]
  );
  return {moved:true,folder:target,notice:
    target==='trash'
      ?'Moved to Resend Trash (provider schedules deletion after 30 days).'
      :'Moved to '+target+' on Resend.'};
}
