// ENKYRON E02: local plain-text mail drafts only. No send, SMTP, provider, or network transport.
// Research buyer names/emails are NEVER automatically inserted as recipients.
// Workspace is a single OS user's local partition, not authenticated multi-tenant RBAC.
import {createHash,randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';
import {requireOpportunityId} from './enkyron-crm-activities.mjs';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function plain(input,label,max,allowNewline){
  if(typeof input!=='string'||input.length>max
      ||(allowNewline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(input)){
    throw new Error('CRM invalid mail '+label);
  }
  return input.trim();
}
function contentFields(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid draft request');
  const recipient_email=plain(input.recipient_email??'','recipient',254,false);
  if(recipient_email && (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient_email)
      ||recipient_email.includes(',')||recipient_email.includes(';'))){
    throw new Error('CRM invalid recipient email');
  }
  const subject=plain(input.subject??'','subject',200,false);
  const body_text=plain(input.body_text??'','body',20000,true);
  if(!subject&&!body_text)throw new Error('CRM draft requires a subject or body');
  return {recipient_email,subject,body_text};
}
export function validateDraftCreate(input){
  const content=contentFields(input);
  const opportunity_id=input.opportunity_id==null?null:requireOpportunityId(input.opportunity_id);
  const company_id=input.company_id==null?null:requireCompanyId(input.company_id);
  if((opportunity_id===null)===(company_id===null))
    throw new Error('CRM draft requires exactly one company or opportunity');
  return {opportunity_id,company_id,...content};
}
export function validateDraftUpdate(input){
  const content=contentFields(input);
  if(typeof input.id!=='string'||!UUID.test(input.id))
    throw new Error('CRM invalid draft identifier');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid draft revision');
  return {id:input.id,expected_revision:input.expected_revision,...content};
}
function fingerprint(item){
  return createHash('sha256').update(JSON.stringify([
    item.recipient_email||'',item.subject,item.body_text
  ])).digest('hex');
}
export async function listMailDrafts(pool,search,actor){
  const query=boundedSearch(search),owner=scope(actor);
  try{
    const result=await pool.query(
      'SELECT d.id,d.opportunity_id,d.company_id,d.recipient_email,d.subject,d.revision,'
      +'d.updated_at,COALESCE(c.name,o.company_name_at_creation) AS company_name_at_creation '
      +'FROM enkyron_crm_mail_drafts d '
      +'LEFT JOIN enkyron_crm_opportunities o '
      +'ON o.id=d.opportunity_id AND o.workspace_key=d.workspace_key '
      +'LEFT JOIN enkyron_crm_companies c '
      +'ON c.id=d.company_id AND c.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 '
      +"AND ($2='' OR POSITION(lower($2) IN lower(COALESCE(c.name,o.company_name_at_creation,'')))>0 "
      +"OR POSITION(lower($2) IN lower(d.subject))>0 "
      +"OR POSITION(lower($2) IN lower(coalesce(d.recipient_email,'')))>0) "
      +'ORDER BY d.updated_at DESC,d.id DESC LIMIT 101',
      [owner.key,query]
    );
    return {available:true,items:result.rows.slice(0,100),
      more:result.rows.length>100,kind:'local_unsent_drafts'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],more:false,
      notice:'CRM mail draft schema 070 not installed locally.'};
    throw e;
  }
}
export async function readMailDraft(pool,id,actor){
  if(typeof id!=='string'||!UUID.test(id))throw new Error('CRM invalid draft identifier');
  const owner=scope(actor);
  try{
    const row=(await pool.query(
      'SELECT d.id,d.opportunity_id,d.company_id,d.recipient_email,d.subject,d.body_text,'
      +'d.revision,d.updated_at,'
      +'COALESCE(c.name,o.company_name_at_creation) AS company_name_at_creation '
      +'FROM enkyron_crm_mail_drafts d '
      +'LEFT JOIN enkyron_crm_opportunities o '
      +'ON o.workspace_key=d.workspace_key AND o.id=d.opportunity_id '
      +'LEFT JOIN enkyron_crm_companies c '
      +'ON c.workspace_key=d.workspace_key AND c.id=d.company_id '
      +'WHERE d.workspace_key=$1 AND d.id=$2',
      [owner.key,id]
    )).rows[0];
    if(!row)throw new Error('CRM draft not found in local workspace');
    return {available:true,draft:row};
  }catch(e){
    if(e?.code==='42P01')return {available:false,
      notice:'CRM mail draft schema 070 not installed locally.'};
    throw e;
  }
}
async function transact(pool,work){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
export async function createMailDraft(pool,input,actor,options={}){
  const data=validateDraftCreate(input),owner=scope(actor),uuid=options.uuid??randomUUID;
  return transact(pool,async client=>{
    const companyMode=data.company_id!==null;
    const source=companyMode?'enkyron_crm_companies':'enkyron_crm_opportunities';
    const parentId=companyMode?data.company_id:data.opportunity_id;
    const parent=(await client.query(
      'SELECT id FROM '+source+' WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.key,parentId]
    )).rows[0];
    if(!parent)throw new Error(
      'CRM '+(companyMode?'company':'opportunity')+' not found in local workspace'
    );
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_mail_drafts '
      +'(id,workspace_key,opportunity_id,company_id,recipient_email,subject,body_text,'
      +'created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [id,owner.key,data.opportunity_id,data.company_id,data.recipient_email||null,
        data.subject,data.body_text,owner.name]
    );
    await client.query(
      'INSERT INTO enkyron_crm_mail_draft_events '
      +'(id,workspace_key,draft_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,1,'created',$4,$5)",
      [uuid(),owner.key,id,fingerprint(data),owner.name]
    );
    return {id,revision:1,opportunity_id:data.opportunity_id,company_id:data.company_id,
      notice:'Saved locally as an unsent draft. No email has been transmitted.'};
  });
}
export async function updateMailDraft(pool,input,actor,options={}){
  const data=validateDraftUpdate(input),owner=scope(actor),uuid=options.uuid??randomUUID;
  return transact(pool,async client=>{
    const previous=(await client.query(
      'SELECT id,recipient_email,subject,body_text,revision '
      +'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [owner.key,data.id]
    )).rows[0];
    if(!previous)throw new Error('CRM draft not found in local workspace');
    if(previous.revision!==data.expected_revision)
      throw new Error('CRM draft was changed; reopen the latest revision');
    if((previous.recipient_email||'')===data.recipient_email
        && previous.subject===data.subject
        && previous.body_text===data.body_text)
      throw new Error('CRM draft has no changes to save');
    const version=data.expected_revision+1;
    const updated=(await client.query(
      'UPDATE enkyron_crm_mail_drafts '
      +'SET recipient_email=$3,subject=$4,body_text=$5,revision=$6,'
      +'updated_by=$7,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND revision=$8 RETURNING id,revision',
      [owner.key,data.id,data.recipient_email||null,data.subject,data.body_text,
        version,owner.name,data.expected_revision]
    )).rows[0];
    if(!updated)throw new Error('CRM draft revision conflict');
    await client.query(
      'INSERT INTO enkyron_crm_mail_draft_events '
      +'(id,workspace_key,draft_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,'edited',$5,$6)",
      [uuid(),owner.key,data.id,version,fingerprint(data),owner.name]
    );
    return {id:data.id,revision:version,
      notice:'Updated local unsent draft; no external communication occurred.'};
  });
}
