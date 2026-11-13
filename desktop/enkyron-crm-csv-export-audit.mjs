// E02-08D: append-only, privacy-minimized export attempt / file outcome receipts.
// OS username is local scope only; not remotely authenticated RBAC or an attested file signature.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAIL=new Set(['file_error','verification_error','unknown']);
function scope(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
function only(input,allowed,name){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!allowed.includes(k)))
  throw new Error('CRM invalid '+name);
}
export function validateExportStart(input){
 only(input,['company_id','company_version','contact_count','confirmed'],'CSV export start');
 if(input.confirmed!==true)throw new Error('CRM export requires human confirmation');
 if(!Number.isInteger(input.company_version)||input.company_version<1)
  throw new Error('CRM invalid company export version');
 if(!Number.isInteger(input.contact_count)||input.contact_count<0||input.contact_count>500)
  throw new Error('CRM invalid exported contact count');
 return {company_id:requireCompanyId(input.company_id),
  company_version:input.company_version,contact_count:input.contact_count};
}
export function validateExportFinish(input){
 only(input,['export_id','company_id','event_type','file_sha256','file_bytes',
  'record_count','failure_category'],'CSV export result');
 if(typeof input.export_id!=='string'||!UUID.test(input.export_id))
  throw new Error('CRM invalid export receipt identifier');
 const company_id=requireCompanyId(input.company_id);
 if(input.event_type==='completed'){
  if(typeof input.file_sha256!=='string'||!SHA.test(input.file_sha256)||
     !Number.isInteger(input.file_bytes)||input.file_bytes<1||input.file_bytes>1048576||
     !Number.isInteger(input.record_count)||input.record_count<1||input.record_count>501||
     input.failure_category!==undefined)
   throw new Error('CRM invalid completed export receipt');
 }else if(input.event_type==='failed'){
  if(!FAIL.has(input.failure_category)||input.file_sha256!==undefined||
     input.file_bytes!==undefined||input.record_count!==undefined)
   throw new Error('CRM invalid failed export receipt');
 }else throw new Error('CRM invalid export outcome');
 return {...input,company_id};
}
export async function beginCsvExport(pool,input,actor,options={}){
 const request=validateExportStart(input),workspace=scope(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const company=(await client.query(
   'SELECT id,record_version FROM enkyron_crm_companies '
   +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
   [workspace,request.company_id])).rows[0];
  if(!company)throw new Error('CRM company not found in local workspace');
  if(company.record_version!==request.company_version)
   throw new Error('CRM stale CSV export company revision; refresh and retry');
  const count=Number((await client.query(
   'SELECT count(*)::integer AS n FROM enkyron_crm_contacts '
   +'WHERE workspace_key=$1 AND company_id=$2',
   [workspace,request.company_id])).rows[0]?.n);
  if(count!==request.contact_count)
   throw new Error('CRM CSV contacts changed since snapshot; refresh and retry');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_csv_export_events '
   +'(id,workspace_key,export_id,company_id,event_type,company_record_version,'
   +'expected_contact_count,recorded_by) '
   +"VALUES($1,$2,$1,$3,'started',$4,$5,$6)",
   [id,workspace,request.company_id,request.company_version,request.contact_count,actor]);
  await client.query('COMMIT');
  return {export_id:id,company_id:request.company_id,contact_count:request.contact_count,
   notice:'Export attempt recorded. File creation and completion receipt still pending.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
export async function finishCsvExport(pool,input,actor,options={}){
 const result=validateExportFinish(input),workspace=scope(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   [workspace+':csv-export:'+result.export_id]);
  const started=(await client.query(
   "SELECT id,company_id,company_record_version,expected_contact_count "
   +"FROM enkyron_crm_csv_export_events WHERE workspace_key=$1 AND export_id=$2 "
   +"AND event_type='started' AND recorded_by=$3 FOR KEY SHARE",
   [workspace,result.export_id,actor])).rows[0];
  if(!started||started.company_id!==result.company_id)
   throw new Error('CRM export intent missing or belongs to another operator/company');
  const terminal=(await client.query(
   "SELECT id FROM enkyron_crm_csv_export_events WHERE workspace_key=$1 "
   +"AND export_id=$2 AND event_type IN ('completed','failed') LIMIT 1",
   [workspace,result.export_id])).rows;
  if(terminal.length)throw new Error('CRM export already finalized');
  if(result.event_type==='completed'&&result.record_count!==started.expected_contact_count+1)
   throw new Error('CRM export receipt count disagrees with recorded intent');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_csv_export_events '
   +'(id,workspace_key,export_id,company_id,event_type,company_record_version,'
   +'expected_contact_count,file_sha256,file_bytes,record_count,failure_category,recorded_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [id,workspace,result.export_id,result.company_id,result.event_type,
    started.company_record_version,started.expected_contact_count,
    result.event_type==='completed'?result.file_sha256:null,
    result.event_type==='completed'?result.file_bytes:null,
    result.event_type==='completed'?result.record_count:null,
    result.event_type==='failed'?result.failure_category:null,actor]);
  await client.query('COMMIT');
  return {export_id:result.export_id,status:result.event_type,company_id:result.company_id,
   notice:'Export outcome recorded without filenames or personal data.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='23505')throw new Error('CRM export outcome already recorded');
  throw error;
 }finally{client.release();}
}
export async function listCsvExportEvents(pool,companyId,actor){
 const company_id=requireCompanyId(companyId),workspace=scope(actor);
 try {
  const company=(await pool.query(
   'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
   [workspace,company_id])).rows[0];
  if(!company)throw new Error('CRM company not found in local workspace');
  const rows=(await pool.query(
   'SELECT export_id,event_type,expected_contact_count,file_sha256,file_bytes,record_count,'
   +'failure_category,recorded_by,recorded_at '
   +'FROM enkyron_crm_csv_export_events WHERE workspace_key=$1 AND company_id=$2 '
   +'ORDER BY recorded_at DESC,id DESC LIMIT 51',
   [workspace,company_id])).rows;
  return {available:true,company_id,items:rows.slice(0,50),more:rows.length>50,
   notice:'Local operator metadata, not proof of recipient authorization or delivery.'};
 }catch(error){
  if(error?.code==='42P01')return {available:false,items:[],
   notice:'CSV export audit schema 089 is not installed.'};
  throw error;
 }
}
