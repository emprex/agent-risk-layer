// ENKYRON CRM commercial proposals: priced, versioned LOCAL DRAFTS only.
// No sending, accepted/signed states, VAT computation, contract, or billing.
import {createHash,randomUUID} from 'node:crypto';
import {boundedSearch} from './enkyron-contract.mjs';
import {requireOpportunityId} from './enkyron-crm-activities.mjs';
const UUID_CANON=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CURRENCIES=Object.freeze(['GBP','EUR','USD']);
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,name:actor};
}
function field(value,label,min,max,multiline){
  if(typeof value!=='string'||value.length>max||
     (multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value))
    throw new Error('CRM invalid proposal '+label);
  const trimmed=value.trim();
  if(trimmed.length<min||trimmed.length>max)throw new Error('CRM invalid proposal '+label);
  return trimmed;
}
function contentFields(data){
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('CRM invalid proposal request');
  const title=field(data.title,'title',5,160,false);
  const scope_text=field(data.scope_text,'scope',20,5000,true);
  if(!CURRENCIES.includes(data.currency))
    throw new Error('CRM invalid proposal currency');
  if(!Number.isSafeInteger(data.amount_minor)||
     data.amount_minor<1||data.amount_minor>999999999)
    throw new Error('CRM proposal price must be a positive amount in minor units');
  return {title,scope_text,currency:data.currency,amount_minor:data.amount_minor};
}
export function validateProposalCreate(input){
  const content=contentFields(input);
  return {opportunity_id:requireOpportunityId(input.opportunity_id),...content};
}
export function validateProposalUpdate(input){
  const content=contentFields(input);
  if(typeof input.id!=='string'||!UUID_CANON.test(input.id))
    throw new Error('CRM invalid proposal identifier');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid proposal revision');
  return {id:input.id,expected_revision:input.expected_revision,...content};
}
function digest(data){
  return createHash('sha256').update(JSON.stringify([
    data.title,data.scope_text,data.currency,data.amount_minor
  ])).digest('hex');
}
export async function listProposalDrafts(pool,search,actor){
  const query=boundedSearch(search),owner=scope(actor);
  try{
    const rows=(await pool.query(
      'SELECT d.id,d.opportunity_id,d.title,d.currency,d.amount_minor,'
      +'d.revision,d.updated_at,o.company_name_at_creation '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.id=d.opportunity_id AND o.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 '
      +"AND ($2='' OR POSITION(lower($2) IN lower(d.title))>0 "
      +'OR POSITION(lower($2) IN lower(o.company_name_at_creation))>0) '
      +'ORDER BY d.updated_at DESC,d.id DESC LIMIT 101',
      [owner.key,query]
    )).rows;
    return {available:true,items:rows.slice(0,100),more:rows.length>100,
      notice:'Operator-priced, unsent proposal drafts. No tax determination.'};
  }catch(e){
    if(e?.code==='42P01')return {available:false,items:[],more:false,
      notice:'Proposal drafts are unavailable until the CRM update is installed.'};
    throw e;
  }
}
export async function readProposalDraft(pool,id,actor){
  if(typeof id!=='string'||!UUID_CANON.test(id))
    throw new Error('CRM invalid proposal identifier');
  const owner=scope(actor);
  try{
    const row=(await pool.query(
      'SELECT d.id,d.opportunity_id,d.title,d.scope_text,d.currency,d.amount_minor,'
      +'d.revision,d.updated_at,o.company_name_at_creation '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.id=d.opportunity_id AND o.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 AND d.id=$2',
      [owner.key,id]
    )).rows[0];
    if(!row)throw new Error('CRM proposal not found in local workspace');
    return {available:true,proposal:row};
  }catch(e){
    if(e?.code==='42P01')return {available:false,
      notice:'Proposal drafts are unavailable until the CRM update is installed.'};
    throw e;
  }
}
async function transaction(pool,work){
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
export async function createProposalDraft(pool,input,actor,options={}){
  const data=validateProposalCreate(input),owner=scope(actor),uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const found=(await client.query(
      'SELECT id FROM enkyron_crm_opportunities '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.key,data.opportunity_id]
    )).rows[0];
    if(!found)throw new Error('CRM opportunity not found in local workspace');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_drafts '
      +'(id,workspace_key,opportunity_id,title,scope_text,currency,amount_minor,'
      +'created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [id,owner.key,data.opportunity_id,data.title,data.scope_text,
        data.currency,data.amount_minor,owner.name]
    );
    await client.query(
      'INSERT INTO enkyron_crm_proposal_draft_events '
      +'(id,workspace_key,proposal_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,1,'created',$4,$5)",
      [uuid(),owner.key,id,digest(data),owner.name]
    );
    return {id,revision:1,opportunity_id:data.opportunity_id,
      notice:'Commercial proposal draft saved. It has not been issued, accepted or sent.'};
  });
}
export async function updateProposalDraft(pool,input,actor,options={}){
  const data=validateProposalUpdate(input),owner=scope(actor),uuid=options.uuid??randomUUID;
  return transaction(pool,async client=>{
    const current=(await client.query(
      'SELECT title,scope_text,currency,amount_minor,revision '
      +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [owner.key,data.id]
    )).rows[0];
    if(!current)throw new Error('CRM proposal not found in local workspace');
    if(current.revision!==data.expected_revision)
      throw new Error('CRM proposal changed since it was opened; reopen latest version');
    // Once a detailed quote is itemized, the total belongs to its lines,
    // never to the standalone fee input of the original draft editor.
    const itemized=(await client.query(
      'SELECT count(*)::integer AS n FROM enkyron_crm_proposal_lines '
      +'WHERE workspace_key=$1 AND proposal_id=$2',
      [owner.key,data.id]
    )).rows[0]?.n??0;
    if(itemized>0&&Number(current.amount_minor)!==data.amount_minor)
      throw new Error('CRM proposal total is computed from quote lines; use Edit lines');
    if(current.title===data.title&&current.scope_text===data.scope_text&&
      current.currency===data.currency&&Number(current.amount_minor)===data.amount_minor)
      throw new Error('CRM proposal has no changes to save');
    const next=data.expected_revision+1;
    const updated=(await client.query(
      'UPDATE enkyron_crm_proposal_drafts '
      +'SET title=$3,scope_text=$4,currency=$5,amount_minor=$6,'
      +'revision=$7,updated_by=$8,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND revision=$9 RETURNING revision',
      [owner.key,data.id,data.title,data.scope_text,data.currency,
        data.amount_minor,next,owner.name,data.expected_revision]
    )).rows[0];
    if(!updated)throw new Error('CRM proposal revision conflict');
    await client.query(
      'INSERT INTO enkyron_crm_proposal_draft_events '
      +'(id,workspace_key,proposal_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,'edited',$5,$6)",
      [uuid(),owner.key,data.id,next,digest(data),owner.name]
    );
    return {id:data.id,revision:next,
      notice:'Proposal draft updated. No contract, tax or delivery action occurred.'};
  });
}
