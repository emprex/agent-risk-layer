/* ENKYRON M03-C: additive professional recipient persistence.
 * Pure input validation and parameterized SQL; never sends mail.
 * The existing legacy draft path stays usable before migration 117.
 */
import {mailAddress,validateRecipientGroups}
  from './enkyron-mail-recipient-policy.mjs';

const FIELDS=['to_recipients','cc_recipients','bcc_recipients'];
const ALIASES=['to','cc','bcc'];
const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);

export function professionalRecipientPayload(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))
    throw new Error('CRM invalid M03 recipient request');
  if(ALIASES.some(field=>has(input,field)))
    throw new Error('CRM M03 requires explicit *_recipients arrays');
  const present=FIELDS.filter(field=>has(input,field));
  if(!present.length)return null; // Existing callers are untouched.
  if(present.length!==FIELDS.length)
    throw new Error('CRM M03 requires To, CC and BCC arrays together');
  let groups;
  try{
    groups=validateRecipientGroups({
      to:input.to_recipients,cc:input.cc_recipients,bcc:input.bcc_recipients
    });
  }catch(error){
    throw new Error('CRM M03 invalid recipient groups: '+error.message);
  }
  if(input.recipient_email!=null && String(input.recipient_email).trim()){
    let primary;
    try{primary=mailAddress(input.recipient_email);}
    catch{throw new Error('CRM M03 invalid primary recipient');}
    if(primary!==groups.to[0])
      throw new Error('CRM M03 primary recipient does not match first To');
  }
  return {
    recipient_email:groups.to[0],
    to_recipients:groups.to,
    cc_recipients:groups.cc,
    bcc_recipients:groups.bcc
  };
}

// The caller must already hold the draft lock inside its existing transaction.
export async function persistProfessionalRecipients(client,workspaceKey,draftId,fields){
  const result=await client.query(
    'UPDATE enkyron_crm_mail_drafts SET '
    +'to_recipients=$3::jsonb,cc_recipients=$4::jsonb,bcc_recipients=$5::jsonb '
    +'WHERE workspace_key=$1 AND id=$2 RETURNING id',
    [workspaceKey,draftId,
      JSON.stringify(fields.to_recipients),
      JSON.stringify(fields.cc_recipients),
      JSON.stringify(fields.bcc_recipients)]
  );
  if(result.rows.length!==1)
    throw new Error('CRM M03 recipient draft scope changed; rolled back');
}

export async function previousProfessionalRecipients(client,workspaceKey,draftId){
  const result=await client.query(
    'SELECT to_recipients,cc_recipients,bcc_recipients '
    +'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
    [workspaceKey,draftId]
  );
  if(result.rows.length!==1)
    throw new Error('CRM M03 recipient draft not found');
  return result.rows[0];
}

// Metadata probe is safe on pre-117 PostgreSQL and doesn't mutate the DB.
// A partially installed recipient schema is never treated as a legacy schema.
export async function optionallyReadProfessionalRecipients(pool,workspaceKey,draftId){
  const metadata=await pool.query(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_attribute "
    +"WHERE attrelid=to_regclass('public.enkyron_crm_mail_drafts') "
    +"AND attname IN ('to_recipients','cc_recipients','bcc_recipients') "
    +'AND NOT attisdropped'
  );
  const count=Number(metadata.rows[0]?.n??0);
  if(count===0)return null;
  if(count!==3)throw new Error('CRM M03 recipient schema incomplete');
  const result=await pool.query(
    'SELECT to_recipients,cc_recipients,bcc_recipients '
    +'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2',
    [workspaceKey,draftId]
  );
  return result.rows[0]??null;
}

// Both legacy Resend routes must refuse professional recipient snapshots
// until their exact reviewed multi-recipient payload is implemented.
export function assertLegacySingleRecipientSnapshot(primary,groups){
  if(groups===null)return;
  const {to_recipients:to,cc_recipients:cc,bcc_recipients:bcc}=groups||{};
  if(!Array.isArray(to)||!Array.isArray(cc)||!Array.isArray(bcc)
      ||to.length>1||cc.length>0||bcc.length>0
      ||(to.length===1&&String(to[0]).toLowerCase()
        !==String(primary||'').toLowerCase()))
    throw new Error('CRM M03 recipient list requires upgraded send transport; no email sent');
}
