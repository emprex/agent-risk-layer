// E02-04A: operator-scoped read-only identity clues, NOT an automated merge.
import {validateCompany,validateContact} from './enkyron-crm.mjs';
function scope(actor) {
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
function hostname(raw) {
 if(!raw)return '';
 try {
  const u=new URL(raw);
  return ['http:','https:'].includes(u.protocol) && !u.username && !u.password
   ? u.hostname.toLowerCase().replace(/^www\./,'') : '';
 } catch {return '';}
}
const norm=x=>"lower(regexp_replace(btrim(coalesce("+x+",'')), '[^[:alnum:]]', '', 'g'))";
export async function previewCompanyDuplicates(pool,input,actor){
 const data=validateCompany(input),key=scope(actor),domain=hostname(data.website);
 const client=await pool.connect();let active=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  const name=norm('c.name'),legal=norm('c.legal_name');
  const given=norm('$2::text'),givenLegal=norm('$3::text');
  const host="lower(regexp_replace(split_part(split_part(regexp_replace("
   +"coalesce(c.website,''),'^https?://','','i'), '/',1), ':',1), '^www\\.', '', 'i'))";
  const sql="SELECT c.id,c.name,c.legal_name,c.website,"
   +"("+name+"="+given+" AND "+given+"<>'') AS name_match,"
   +"("+givenLegal+"<>'' AND "+legal+"="+givenLegal+") AS legal_name_match,"
   +"($4::text<>'' AND "+host+"=$4) AS domain_match "
   +"FROM enkyron_crm_companies c WHERE c.workspace_key=$1 AND ("
   +"("+given+"<>'' AND "+name+"="+given+") OR "
   +"("+givenLegal+"<>'' AND "+legal+"="+givenLegal+") OR "
   +"($4::text<>'' AND "+host+"=$4)) ORDER BY c.name,c.id LIMIT 26";
  const rows=(await client.query(sql,[key,data.name,data.legal_name,domain])).rows;
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
  const name=norm('ct.full_name'),given=norm('$3::text');
  const sql="SELECT ct.id,ct.full_name,ct.company_id,c.name AS company_name,"
   +"(ct.company_id=$2 AND "+given+"<>'' AND "+name+"="+given+") AS name_same_company,"
   +"($4::text<>'' AND lower(btrim(coalesce(ct.email,'')))=lower(btrim($4::text))) AS email_same_workspace "
   +"FROM enkyron_crm_contacts ct JOIN enkyron_crm_companies c "
   +"ON c.workspace_key=ct.workspace_key AND c.id=ct.company_id "
   +"WHERE ct.workspace_key=$1 AND ("
   +"(ct.company_id=$2 AND "+given+"<>'' AND "+name+"="+given+") OR "
   +"($4::text<>'' AND lower(btrim(coalesce(ct.email,'')))=lower(btrim($4::text)))) "
   +"ORDER BY ct.created_at DESC,ct.id LIMIT 26";
  const rows=(await client.query(sql,[key,data.company_id,data.full_name,data.email])).rows;
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
