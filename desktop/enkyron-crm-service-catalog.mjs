// E07-02A. Commercial service fiches, prices and immutable operator revisions.
// "Available" means only operator-authorised for inclusion in a manual draft,
// NOT a guarantee of tested technical capability, tax, certification or signature.
import {createHash,randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAMILIES=new Set([
  'agent_assessment','mcp_api','security_testing','remediation_retest',
  'advisory','continuous','other'
]);
const MODELS=new Set(['fixed','custom_quote','recurring']);
const STATES=new Set(['draft','available','retired']);
const CURRENCIES=new Set(['GBP','EUR','USD']);
const PERIODS=new Set(['monthly','quarterly','yearly']);
const KEY=/^[A-Z][A-Z0-9_-]{2,47}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function workspace(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function uuid(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('CRM invalid service identifier');
  return value;
}
function string(value,name,min,max,optional=false){
  if(optional&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||value.length>max||CONTROL.test(value))
    throw new Error('CRM invalid service '+name);
  const clean=value.trim();
  if(clean.length<min||clean.length>max)
    throw new Error('CRM service '+name+' requires '+min+'–'+max+' characters');
  return clean;
}
export function validateServiceCatalog(input,editing=false){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid catalogue request');
  if(input.confirmed!==true)
    throw new Error('CRM explicit operator catalogue confirmation required');
  const code=string(input.service_code,'code',3,48);
  if(!KEY.test(code))throw new Error('CRM service code must be uppercase ASCII code');
  if(!FAMILIES.has(input.family))throw new Error('CRM invalid service family');
  if(!MODELS.has(input.pricing_model))throw new Error('CRM invalid service pricing model');
  if(!STATES.has(input.status))throw new Error('CRM invalid service status');
  if(!CURRENCIES.has(input.currency))throw new Error('CRM invalid service currency');
  const period=input.billing_period??null;
  const price=input.price_minor??null;
  if(price!==null&&(!Number.isSafeInteger(price)||price<1||price>999999999))
    throw new Error('CRM service price must be positive integer minor units');
  if(input.pricing_model==='custom_quote'&&(price!==null||period!==null))
    throw new Error('CRM custom quote must not set a fixed price or recurring period');
  if(input.pricing_model==='fixed'&&period!==null)
    throw new Error('CRM fixed service must not have billing period');
  if(input.pricing_model==='recurring'&&!PERIODS.has(period))
    throw new Error('CRM recurring service requires a billing period');
  if(input.status==='available'&&input.pricing_model!=='custom_quote'&&price===null)
    throw new Error('CRM available priced service requires operator-entered price');
  const value={
    service_code:code,
    name:string(input.name,'name',5,160),
    family:input.family,
    summary:string(input.summary,'summary',20,1200),
    inclusions:string(input.inclusions,'inclusions',20,3000),
    exclusions:string(input.exclusions,'exclusions',20,3000),
    deliverables:string(input.deliverables,'deliverables',20,3000),
    prerequisites:string(input.prerequisites,'prerequisites',20,3000),
    technical_notes:string(input.technical_notes,'technical notes',20,3000,true),
    pricing_model:input.pricing_model,
    currency:input.currency,
    price_minor:price,
    billing_period:period,
    status:input.status,
    review_note:string(input.review_note,'operator rationale',20,1200)
  };
  if(editing){
    value.id=uuid(input.id);
    if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
      throw new Error('CRM invalid catalogue revision');
    value.expected_revision=input.expected_revision;
  }
  return value;
}
const FIELDS=[
 'service_code','name','family','summary','inclusions','exclusions',
 'deliverables','prerequisites','technical_notes','pricing_model',
 'currency','price_minor','billing_period','status','review_note'
];
function hash(data){
  return createHash('sha256').update(JSON.stringify(FIELDS.map(k=>data[k]))).digest('hex');
}
async function snapshot(client,identity,data,rev,ids){
  await client.query(
    'INSERT INTO enkyron_crm_service_catalog_versions '
    +'(id,workspace_key,service_id,revision,'
    +FIELDS.join(',')+',recorded_by,content_sha256) '
    +'VALUES('+Array.from({length:FIELDS.length+6},(_,i)=>'$'+(i+1)).join(',')+')',
    [ids(),identity.key,data.id,rev,...FIELDS.map(k=>data[k]),identity.name,hash(data)]
  );
}
export async function listServiceCatalog(pool,search,actor){
  const identity=workspace(actor),q=boundedSearch(search);
  try{
    const rows=(await pool.query(
      'SELECT id,service_code,name,family,summary,inclusions,exclusions,'
      +'deliverables,prerequisites,technical_notes,pricing_model,currency,'
      +'price_minor,billing_period,status,revision,review_note,updated_by,updated_at '
      +'FROM enkyron_crm_service_catalog WHERE workspace_key=$1 '
      +"AND ($2='' OR POSITION(lower($2) IN lower(name))>0 "
      +'OR POSITION(lower($2) IN lower(service_code))>0) '
      +'ORDER BY service_code ASC,id ASC LIMIT 101',[identity.key,q]
    )).rows;
    return {available:true,items:rows.slice(0,100),more:rows.length>100,
      notice:'Prices are human-entered, tax-undetermined; availability does not certify technical readiness.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],
      notice:'Service catalogue migration 098 not installed; no change performed.'};
    throw e;
  }
}
export async function readServiceCatalog(pool,serviceId,actor){
  const identity=workspace(actor),id=uuid(serviceId);
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row=(await client.query(
      'SELECT * FROM enkyron_crm_service_catalog WHERE workspace_key=$1 AND id=$2',
      [identity.key,id]
    )).rows[0];
    if(!row)throw new Error('CRM service not found in local workspace');
    const versions=(await client.query(
      'SELECT revision,status,price_minor,pricing_model,recorded_by,recorded_at,'
      +'content_sha256,review_note FROM enkyron_crm_service_catalog_versions '
      +'WHERE workspace_key=$1 AND service_id=$2 ORDER BY revision DESC LIMIT 21',
      [identity.key,id]
    )).rows;
    await client.query('COMMIT');
    return {available:true,service:row,history:versions.slice(0,20),
      more:versions.length>20};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
export async function createServiceCatalog(pool,input,actor,options={}){
  const data=validateServiceCatalog(input),identity=workspace(actor);
  const ids=options.uuid??randomUUID,id=ids();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO enkyron_crm_service_catalog '
      +'(id,workspace_key,'+FIELDS.join(',')+',revision,updated_by) '
      +'VALUES('+Array.from({length:FIELDS.length+4},(_,i)=>'$'+(i+1)).join(',')+')',
      [id,identity.key,...FIELDS.map(k=>data[k]),1,identity.name]
    );
    await snapshot(client,identity,{...data,id},1,ids);
    await client.query('COMMIT');
    return {id,revision:1,status:data.status,can_issue:false,
      notice:'Catalogue fiche recorded. No quote, tax, contract, invoice or testing action.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
export async function updateServiceCatalog(pool,input,actor,options={}){
  const data=validateServiceCatalog(input,true),identity=workspace(actor);
  const ids=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const old=(await client.query(
      'SELECT * FROM enkyron_crm_service_catalog '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',[identity.key,data.id]
    )).rows[0];
    if(!old)throw new Error('CRM service not found in local workspace');
    if(old.revision!==data.expected_revision)
      throw new Error('CRM service revision changed; refresh before editing');
    if(FIELDS.every(k=>(old[k]??null)===(data[k]??null)))
      throw new Error('CRM no service changes to record');
    const next=old.revision+1;
    const assignments=FIELDS.map((k,i)=>k+'=$'+(i+3)).join(',');
    const updated=(await client.query(
      'UPDATE enkyron_crm_service_catalog SET '+assignments+',revision=$18,'
      +'updated_by=$19,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND revision=$20 RETURNING revision',
      [identity.key,data.id,...FIELDS.map(k=>data[k]),next,identity.name,old.revision]
    )).rows[0];
    if(!updated)throw new Error('CRM catalogue concurrent change; refresh');
    await snapshot(client,identity,data,next,ids);
    await client.query('COMMIT');
    return {id:data.id,revision:next,status:data.status,can_issue:false,
      notice:'Catalog revision recorded. Existing quote snapshots remain unchanged.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
