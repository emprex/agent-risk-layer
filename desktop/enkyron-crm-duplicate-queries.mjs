// Shared candidate predicates for E02-04A preview and E02-04B commit.
// Identity clues only. PostgreSQL checks are ALWAYS scoped to one local workspace.
const norm=x=>"lower(regexp_replace(btrim(coalesce("+x+",'')), '[^[:alnum:]]', '', 'g'))";
export function domainFromWebsite(raw){
 if(!raw)return '';
 try{
  const u=new URL(raw);
  return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password
   ?u.hostname.toLowerCase().replace(/^www\./,''):'';
 }catch{return '';}
}
export async function queryCompanyCandidates(client,data,key){
 const domain=domainFromWebsite(data.website);
 const name=norm('c.name'),legal=norm('c.legal_name'),given=norm('$2::text'),givenLegal=norm('$3::text');
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
 return (await client.query(sql,[key,data.name,data.legal_name,domain])).rows;
}
export async function queryContactCandidates(client,data,key){
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
 return (await client.query(sql,[key,data.company_id,data.full_name,data.email])).rows;
}
