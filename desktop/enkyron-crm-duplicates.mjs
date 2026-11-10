// E02-04A: operator-scoped read-only identity clues, NOT an automated merge.
import {validateCompany,validateContact} from './enkyron-crm.mjs';
import {queryCompanyCandidates,queryContactCandidates} from './enkyron-crm-duplicate-queries.mjs';
function scope(actor) {
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
export async function previewCompanyDuplicates(pool,input,actor){
 const data=validateCompany(input),key=scope(actor);
 const client=await pool.connect();let active=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  const rows=await queryCompanyCandidates(client,data,key);
  await client.query('COMMIT');active=false;
  return {available:true,kind:'company',matches:rows.slice(0,25),more:rows.length>25,
   notice:'Name/domain matches are clues, not verified company identities. No merging or client promotion.'};
 }catch(error){
  if(active)await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='42P01')return {available:false,kind:'company',matches:[],
   notice:'CRM company data is unavailable.'};
  throw error;
 }finally{client.release();}
}
export async function previewContactDuplicates(pool,input,actor){
 const data=validateContact(input),key=scope(actor);
 const client=await pool.connect();let active=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  const company=(await client.query('SELECT id FROM enkyron_crm_companies '
   +'WHERE workspace_key=$1 AND id=$2',[key,data.company_id])).rows[0];
  if(!company)throw new Error('CRM company not found in local workspace');
  const rows=await queryContactCandidates(client,data,key);
  await client.query('COMMIT');active=false;
  return {available:true,kind:'contact',company_id:data.company_id,
   matches:rows.slice(0,25),more:rows.length>25,
   notice:'Contact identity not verified. No contact merge, consent change or outreach.'};
 }catch(error){
  if(active)await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='42P01')return {available:false,kind:'contact',matches:[],
   notice:'CRM contact data is unavailable.'};
  throw error;
 }finally{client.release();}
}
