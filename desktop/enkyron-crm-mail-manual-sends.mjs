// UX-14: operator testimony of an externally sent email tied to an exact local
// draft revision. NOT a Gmail/SMTP integration and NOT proof of delivery.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function operatorScope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function email(value,label){
  if(typeof value!=='string'||value.length>254||!(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/).test(value)
    ||/[;,]/.test(value))throw new Error('CRM invalid manual send '+label);
  return value;
}
export function validateManualSend(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid manual send');
  if(typeof input.draft_id!=='string'||!UUID.test(input.draft_id))
    throw new Error('CRM invalid manual send draft identifier');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid manual send revision');
  if(!['gmail','other'].includes(input.provider))
    throw new Error('CRM invalid manual send provider');
  const ref=input.provider_message_id;
  if(typeof ref!=='string'||!(/^[A-Za-z0-9._:-]{8,200}$/).test(ref))
    throw new Error('CRM invalid manual send provider message identifier');
  const stamp=input.sent_at;
  if(typeof stamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)
    ||!Number.isFinite(Date.parse(stamp))
    ||Date.parse(stamp)>Date.now()+5*60*1000)
    throw new Error('CRM invalid manual send timestamp with explicit timezone');
  if(input.confirmed!==true)throw new Error('CRM manual send operator confirmation required');
  return {draft_id:input.draft_id,expected_revision:input.expected_revision,
    provider:input.provider,provider_message_id:ref,
    sender_email:email(input.sender_email,'sender'),sent_at:stamp};
}
export async function recordManualSend(pool,input,actor,options={}){
  const data=validateManualSend(input),owner=operatorScope(actor);
  const uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const draft=(await client.query(
      'SELECT id,revision,recipient_email FROM enkyron_crm_mail_drafts '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [owner.key,data.draft_id]
    )).rows[0];
    if(!draft)throw new Error('CRM draft not found in local workspace');
    if(draft.revision!==data.expected_revision)
      throw new Error('CRM draft changed; reopen latest revision before recording external send');
    if(!draft.recipient_email)throw new Error('CRM draft recipient must be recorded before external send');
    const exists=(await client.query(
      'SELECT id FROM enkyron_crm_mail_manual_sends WHERE workspace_key=$1 AND draft_id=$2',
      [owner.key,data.draft_id]
    )).rows[0];
    if(exists)throw new Error('CRM draft already has a manual external send record');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_mail_manual_sends '
      +'(id,workspace_key,draft_id,draft_revision,provider,provider_message_id,'
      +'sender_email,recipient_email,sent_at,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id,owner.key,data.draft_id,data.expected_revision,
        data.provider,data.provider_message_id,data.sender_email,draft.recipient_email,
        data.sent_at,owner.name]
    );
    await client.query('COMMIT');
    return {id,draft_id:data.draft_id,draft_revision:data.expected_revision,
      notice:'Operator-reported external send recorded. No provider verification or email transmission.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error?.code==='23505')throw new Error('CRM manual send reference already recorded');
    throw error;
  }finally{client.release();}
}
