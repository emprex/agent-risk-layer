// E02-08A: read-only, selected-company CSV snapshot; never imports or sends data.
// By design emails, phone, prospect research, tickets, financial and source data are excluded.
// Exporting contact names is personal-data processing; the human chooses the destination.
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const MAX_CONTACTS=500;
function key(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
export async function readCompanyCsv(pool,companyId,actor){
 const id=requireCompanyId(companyId),workspace=key(actor);
 const client=await pool.connect();
 let active=false;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  active=true;
  const company=(await client.query(
   'SELECT id,name,legal_name,sector,city,country,relationship_state,record_version '
   +'FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
   [workspace,id])).rows[0];
  if(!company)throw new Error('CRM company not found in local workspace');
  const contacts=(await client.query(
   'SELECT id,full_name,job_title,marketing_permission,record_version '
   +'FROM enkyron_crm_contacts WHERE workspace_key=$1 AND company_id=$2 '
   +'ORDER BY id ASC LIMIT 501',
   [workspace,id])).rows;
  if(contacts.length>MAX_CONTACTS)
   throw new Error('CRM CSV export refused: over 500 contacts; no partial export');
  await client.query('COMMIT');active=false;
  return {available:true,format:'ENKYRON_CRM_SELECTED_COMPANY_V1',
   company,contacts,contact_count:contacts.length,
   notice:'CSV contains contact names; no emails, phone, ticket, invoice or research sources. Local export has no audit receipt yet.'};
 }catch(error){
  if(active)await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='42P01')return {available:false,
   notice:'CRM company/contact schema is not installed.'};
  throw error;
 }finally{client.release();}
}
