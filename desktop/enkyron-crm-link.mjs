// Operator-reviewed, auditable association of historical prospect research.
// Never auto-import, auto-convert contacts/clients, merge, or send email.
import { randomUUID, createHash } from 'node:crypto';
import { validateCompany } from './enkyron-crm.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function workspace(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid operator');
  return {actor,key:'local:'+actor};
}
export function requireProspectId(id){
  if(typeof id!=='string'||!id||id.length>180||/[\x00-\x1f\x7f]/.test(id))
    throw new Error('CRM invalid prospect identifier');
  return id;
}
export function validateProspectLink(data){
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('CRM invalid association request');
  const prospect_id=requireProspectId(data.prospect_id);
  if(typeof data.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(data.source_digest))
    throw new Error('CRM invalid source digest');
  if(!['create','existing'].includes(data.mode))throw new Error('CRM invalid association mode');
  if(data.mode==='existing' && (typeof data.company_id!=='string'||!UUID.test(data.company_id)))
    throw new Error('CRM invalid company identifier');
  if(data.mode==='create' && data.company_id!=null)
    throw new Error('CRM unexpected company identifier');
  if(typeof data.review_note!=='string'||data.review_note.trim().length<20
    ||data.review_note.trim().length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.review_note))
    throw new Error('CRM review note must contain 20-1000 characters');
  if(data.reviewed!==true)throw new Error('CRM manual review confirmation required');
  return {prospect_id,source_digest:data.source_digest,
    mode:data.mode,company_id:data.mode==='existing'?data.company_id:null,
    review_note:data.review_note.trim()};
}
export function sourceDigest(row){
  const keys=['id','company_name','website','buyer_name','buyer_role','buyer_email','source','updated_at'];
  return createHash('sha256').update(JSON.stringify(keys.map(k=>row[k]??null))).digest('hex');
}
function host(raw){
  try{
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)
      ? url.hostname.toLowerCase().replace(/^www\./,'') : '';
  }catch{return '';}
}
const matchSql='SELECT id,name,website,relationship_state FROM enkyron_crm_companies '
  +'WHERE workspace_key=$1 AND (lower(btrim(name))=lower(btrim($2)) '
  +"OR ($3<>'' AND lower(regexp_replace(split_part(regexp_replace("
  +"coalesce(website,''),'^https?://','','i'), '/', 1), '^www\\.','','i'))=$3)) "
  +'ORDER BY name,id LIMIT 26';
async function matches(executor,key,prospect){
  return (await executor.query(matchSql,[key,prospect.company_name,host(prospect.website)])).rows;
}
async function source(executor,id,lock=false){
  const sql='SELECT id,company_name,website,buyer_name,buyer_role,buyer_email,source,updated_at '
     +'FROM sales_prospects WHERE id=$1'+(lock?' FOR SHARE':'');
  const record=(await executor.query(sql,[requireProspectId(id)])).rows[0];
  if(!record)throw new Error('CRM legacy prospect not found');
  return record;
}
export async function previewProspectLink(pool,id,actor){
  const owner=workspace(actor);
  try{
    const prospect=await source(pool,id);
    const links=await pool.query(
      'SELECT l.id,l.company_id,c.name AS company_name,l.linked_at '
      +'FROM enkyron_crm_prospect_links l JOIN enkyron_crm_companies c '
      +'ON c.workspace_key=l.workspace_key AND c.id=l.company_id '
      +'WHERE l.workspace_key=$1 AND l.prospect_id=$2',
      [owner.key,prospect.id]
    );
    const candidates=await matches(pool,owner.key,prospect);
    return {available:true,prospect,source_digest:sourceDigest(prospect),
      linked:links.rows[0]??null,matches:candidates.slice(0,25),
      more_matches:candidates.length>25,
      notice:'Historical research is not proof of identity or marketing consent.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'CRM association migration 066 has not been applied locally.'};
    throw error;
  }
}
export async function associateProspect(pool,input,actor,options={}){
  const req=validateProspectLink(input),owner=workspace(actor),uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(814720266)');
    const candidate=await source(client,req.prospect_id,true);
    if(sourceDigest(candidate)!==req.source_digest)
      throw new Error('CRM source changed since review; reopen candidate');
    const existing=(await client.query(
      'SELECT company_id FROM enkyron_crm_prospect_links WHERE workspace_key=$1 AND prospect_id=$2',
      [owner.key,candidate.id]
    )).rows[0];
    if(existing)throw new Error('CRM prospect already linked; duplicate rejected');
    let companyId=req.company_id,created=false;
    if(req.mode==='create'){
      const identity=validateCompany({name:candidate.company_name,website:candidate.website??''});
      if((await matches(client,owner.key,candidate)).length)
        throw new Error('CRM possible duplicate; link reviewed existing company instead');
      companyId=uuid();
      await client.query(
        'INSERT INTO enkyron_crm_companies '
        +'(id,workspace_key,name,website,relationship_state,source_type,owner_local) '
        +"VALUES ($1,$2,$3,$4,'prospect','manual',$5)",
        [companyId,owner.key,identity.name,identity.website||null,owner.actor]
      );
      await client.query(
        'INSERT INTO enkyron_crm_events '
        +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
        +"VALUES($1,$2,'company',$3,'created',$4)",
        [uuid(),owner.key,companyId,owner.actor]
      );
      created=true;
    }else{
      const company=(await client.query(
        'SELECT id FROM enkyron_crm_companies '
        +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
        [owner.key,companyId]
      )).rows[0];
      if(!company)throw new Error('CRM company not found in local workspace');
    }
    const linkId=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_prospect_links '
      +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
      +'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [linkId,owner.key,candidate.id,companyId,req.source_digest,req.review_note,owner.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_events '
      +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
      +"VALUES ($1,$2,'company',$3,'linked',$4)",
      [uuid(),owner.key,companyId,owner.actor]
    );
    await client.query('COMMIT');
    return {id:linkId,prospect_id:candidate.id,company_id:companyId,
      company_created:created,message:'Source linked after explicit review; no contacts or clients created.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
