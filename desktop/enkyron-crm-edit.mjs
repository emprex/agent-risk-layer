// Local ENKYRON CRM correction workflow, with optimistic concurrency.
// This does NOT change company client-status, buyer-review snapshots, consent,
// prospect links, or authorize communication. Remote multi-user auth is not provided.
import {randomUUID} from 'node:crypto';
import {validateCompany,validateContact} from './enkyron-crm.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const COMPANY_FIELDS=['name','legal_name','sector','city','country','website'];
const CONTACT_FIELDS=['full_name','job_title','email','phone'];
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function checkId(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid '+label);
  return value;
}
function request(payload,fields){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw new Error('CRM invalid record correction');
  const accepted=new Set(['id','expected_version','review_note','confirmed',...fields,
    ...(fields===CONTACT_FIELDS?['company_id']:[])]);
  if(Object.keys(payload).some(k=>!accepted.has(k)))
    throw new Error('CRM correction contains unsupported or privileged fields');
  if(!Number.isSafeInteger(payload.expected_version)||payload.expected_version<1)
    throw new Error('CRM invalid expected record version');
  if(payload.confirmed!==true)
    throw new Error('CRM explicit correction confirmation required');
  // Routine CRM edits do not require a compliance-style explanation.
  // Name/identity changes are checked against the locked record at write time.
  const reason=payload.review_note??'';
  if(typeof reason!=='string'||CONTROL.test(reason)||reason.length>1000||
     (reason.trim().length>0&&reason.trim().length<20))
    throw new Error('CRM rationale must be empty or 20–1000 characters');
  return {id:checkId(payload.id,'CRM record ID'),
    expected_version:payload.expected_version,
    review_note:reason.trim()};
}
export function validateCompanyEdit(payload){
  const base=request(payload,COMPANY_FIELDS);
  // Existing company remains a prospect or whatever its independently governed
  // relationship status was; this form cannot promote it to a verified client.
  const fields=validateCompany(payload);
  return {...base,...fields};
}
export function validateContactEdit(payload){
  const base=request(payload,CONTACT_FIELDS);
  const fields=validateContact(payload);
  return {...base,...fields};
}
async function update(pool,payload,actor,kind,options={}){
  const data=kind==='company'?validateCompanyEdit(payload):validateContactEdit(payload);
  const cols=kind==='company'?COMPANY_FIELDS:CONTACT_FIELDS;
  const table=kind==='company'?'enkyron_crm_companies':'enkyron_crm_contacts';
  const person=owner(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query(
      'SELECT id,workspace_key,record_version,'+cols.join(',')+
      (kind==='contact'?',company_id,marketing_permission,relationship_state':'')+
      ' FROM '+table+' WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [person.key,data.id]
    )).rows[0];
    if(!current)throw new Error('CRM record not found in local workspace');
    if(current.record_version!==data.expected_version)
      throw new Error('CRM record changed; refresh before editing');
    if(kind==='contact'&&current.company_id!==data.company_id)
      throw new Error('CRM contact cannot be moved by correction workflow');
    const changed=cols.filter(k=>(current[k]??'')!==(data[k]??''));
    if(!changed.length)throw new Error('CRM no changed fields; nothing recorded');
    // Company/legal names and contact full names require a reason.
    // Other changed fields stay versioned, attributed and append-only audited.
    const sensitive=kind==='company'
      ?changed.some(k=>k==='name'||k==='legal_name')
      :changed.includes('full_name');
    if(sensitive&&data.review_note.length<20)
      throw new Error('CRM name change requires a 20–1000 character reason');
    const auditNote=data.review_note||
      'Routine CRM field update; no reason supplied by operator.';
    const assignments=cols.map((c,i)=>c+'=$'+(i+3));
    const values=[person.key,data.id,...cols.map(c=>data[c]||null)];
    const result=await client.query(
      'UPDATE '+table+' SET '+assignments.join(',')+
      ',record_version=record_version+1,updated_at=NOW() '+
      'WHERE workspace_key=$1 AND id=$2 AND record_version=$'+(values.length+1)+
      ' RETURNING id,record_version',
      [...values,data.expected_version]
    );
    const row=result.rows[0];
    if(!row)throw new Error('CRM record version conflict');
    const uuid=options.uuid??randomUUID;
    await client.query(
      'INSERT INTO enkyron_crm_record_changes '+
      '(id,workspace_key,resource_kind,resource_id,old_version,new_version,changed_fields,review_note,actor_local) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(),person.key,kind,data.id,data.expected_version,row.record_version,
       changed,auditNote,person.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_events '+
      '(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '+
      "VALUES($1,$2,$3,$4,'updated',$5)",
      [uuid(),person.key,kind,data.id,person.actor]
    );
    await client.query('COMMIT');
    return {id:data.id,record_version:row.record_version,changed_fields:changed,
      notice:'Manual correction saved. No verified identity, consent, client promotion, email or invoice created.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
export const updateCompany=(pool,input,actor,options)=>update(pool,input,actor,'company',options);
export const updateContact=(pool,input,actor,options)=>update(pool,input,actor,'contact',options);

export async function listRecordChanges(pool,kind,id,actor){
  if(!['company','contact'].includes(kind))throw new Error('CRM invalid record type');
  checkId(id,'record ID');
  const person=owner(actor);
  const table=kind==='company'?'enkyron_crm_companies':'enkyron_crm_contacts';
  try{
    const found=(await pool.query('SELECT id,record_version FROM '+table+
      ' WHERE workspace_key=$1 AND id=$2',[person.key,id])).rows[0];
    if(!found)throw new Error('CRM record not found in local workspace');
    const rows=(await pool.query(
      'SELECT id,old_version,new_version,changed_fields,review_note,actor_local,recorded_at '+
      'FROM enkyron_crm_record_changes WHERE workspace_key=$1 AND resource_kind=$2 '+
      'AND resource_id=$3 ORDER BY new_version DESC LIMIT 51',
      [person.key,kind,id]
    )).rows;
    return {available:true,record_version:found.record_version,
      items:rows.slice(0,50),more:rows.length>50};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],
      notice:'CRM manual correction schema 084 is not installed.'};
    throw error;
  }
}
