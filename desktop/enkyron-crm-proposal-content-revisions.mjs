// ENK-04: controlled full-text revision of an UNSENT company proposal draft.
// The legacy updater only preserves hash metadata. This independent route
// copies the old text into an immutable archive, verifies the existing event
// fingerprint, then edits and archives revision N+1 in the SAME transaction.
// Never issues, sends, prices, signs, or authorises any assessment.
import {createHash,randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
function requireId(x,label){
  if(typeof x!=='string'||!UUID.test(x))
    throw new Error('CRM invalid '+label+' ID');
  return x;
}
function digest(data){
  const minor=Number(data.amount_minor);
  if(!Number.isSafeInteger(minor)||minor<1||minor>999999999)
    throw new Error('CRM invalid stored draft price');
  return createHash('sha256').update(JSON.stringify([
    data.title,data.scope_text,data.currency,minor
  ])).digest('hex');
}
function cleanScope(value){
  if(typeof value!=='string'||value.length>5000||
     /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error('CRM invalid revised draft scope');
  const clean=value.trim();
  if(clean.length<20||clean.length>5000)
    throw new Error('CRM invalid revised draft scope');
  // The observed UAT copy/paste defect must not survive into the new revision.
  if(/\bcopier le texte\b/i.test(clean))
    throw new Error('CRM draft scope still contains copied UI text');
  return clean;
}
export function validateCompanyProposalScopeRevision(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     input.confirmed!==true)
    throw new Error('CRM proposal revision needs explicit human confirmation');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM invalid expected revision');
  const note=input.review_note;
  if(typeof note!=='string'||note.trim().length<30||
     note.trim().length>600||/[\x00-\x1f\x7f]/.test(note))
    throw new Error('CRM revised scope requires a documented human review reason');
  return {
    proposal_id:requireId(input.proposal_id,'proposal'),
    opportunity_id:requireId(input.opportunity_id,'opportunity'),
    company_id:requireCompanyId(input.company_id),
    expected_revision:input.expected_revision,
    scope_text:cleanScope(input.scope_text),
    review_note:note.trim(),
  };
}
export async function reviseCompanyProposalScope(pool,input,actor,options={}){
  const data=validateCompanyProposalScopeRevision(input),who=owner(actor);
  const uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  let inTx=false;
  try{
    await client.query('BEGIN');
    inTx=true;
    // UPDATE row lock serializes against legacy draft updates as well as this
    // guarded route: optimistic exact revision check happens under the lock.
    const current=(await client.query(
      'SELECT d.id,d.title,d.scope_text,d.currency,d.amount_minor,d.revision,'
      +'d.opportunity_id,o.company_id,o.source_ticket_id '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.workspace_key=d.workspace_key AND o.id=d.opportunity_id '
      +'WHERE d.workspace_key=$1 AND d.id=$2 AND d.opportunity_id=$3 '
      +'AND o.company_id=$4 AND o.source_ticket_id IS NULL '
      +'FOR UPDATE OF d',
      [who.key,data.proposal_id,data.opportunity_id,data.company_id]
    )).rows[0];
    if(!current)throw new Error('CRM company draft not found under exact local company');
    if(current.revision!==data.expected_revision)
      throw new Error('CRM proposal changed; re-open the latest revision');
    if(current.scope_text===data.scope_text)
      throw new Error('CRM no scope change to record');
    const originalDigest=digest(current);
    const oldEvent=(await client.query(
      'SELECT id,content_sha256 FROM enkyron_crm_proposal_draft_events '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND revision=$3',
      [who.key,data.proposal_id,data.expected_revision]
    )).rows[0];
    if(!oldEvent||oldEvent.content_sha256!==originalDigest)
      throw new Error('CRM old proposal content does not match immutable event hash');
    // Keep this first correction deliberately narrow: itemized quotes and
    // documentary approvals require their own explicit revision workflow.
    const affected=(await client.query(
      'SELECT '
      +'(SELECT count(*)::integer FROM enkyron_crm_proposal_lines '
      +' WHERE workspace_key=$1 AND proposal_id=$2) AS lines, '
      +'(SELECT count(*)::integer FROM enkyron_crm_proposal_internal_decisions '
      +' WHERE workspace_key=$1 AND proposal_id=$2) AS decisions, '
      +'(SELECT count(*)::integer FROM enkyron_crm_sow_draft_versions '
      +' WHERE workspace_key=$1 AND proposal_id=$2) AS sow_versions',
      [who.key,data.proposal_id]
    )).rows[0];
    if(!affected||!['lines','decisions','sow_versions'].every(k=>
      Number.isSafeInteger(affected[k])&&affected[k]===0))
      throw new Error('CRM scope correction blocked by downstream commercial records');
    const savedOld=(await client.query(
      'SELECT id,title,scope_text,currency,amount_minor,content_sha256,source_event_id '
      +'FROM enkyron_crm_proposal_content_versions '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND revision=$3',
      [who.key,data.proposal_id,data.expected_revision]
    )).rows[0]??null;
    let oldSnapshotId=savedOld?.id;
    if(savedOld){
      if(savedOld.content_sha256!==originalDigest||
         savedOld.title!==current.title||
         savedOld.scope_text!==current.scope_text||
         savedOld.currency!==current.currency||
         Number(savedOld.amount_minor)!==Number(current.amount_minor)||
         savedOld.source_event_id!==oldEvent.id)
        throw new Error('CRM existing immutable archive conflicts with current revision');
    }else{
      oldSnapshotId=uuid();
      await client.query(
        'INSERT INTO enkyron_crm_proposal_content_versions '
        +'(id,workspace_key,proposal_id,revision,title,scope_text,currency,'
        +'amount_minor,content_sha256,source_event_id,snapshot_kind,recorded_by) '
        +"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pre_edit_archive',$11)",
        [oldSnapshotId,who.key,data.proposal_id,data.expected_revision,
         current.title,current.scope_text,current.currency,current.amount_minor,
         originalDigest,oldEvent.id,who.actor]
      );
    }
    const next=data.expected_revision+1;
    const updated=(await client.query(
      'UPDATE enkyron_crm_proposal_drafts '
      +'SET scope_text=$3,revision=$4,updated_by=$5,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND revision=$6 RETURNING revision',
      [who.key,data.proposal_id,data.scope_text,next,who.actor,data.expected_revision]
    )).rows[0];
    if(!updated||updated.revision!==next)
      throw new Error('CRM proposal revision conflict');
    const newHash=digest({...current,scope_text:data.scope_text});
    const eventId=uuid(),newSnapshotId=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_proposal_draft_events '
      +'(id,workspace_key,proposal_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,'edited',$5,$6)",
      [eventId,who.key,data.proposal_id,next,newHash,who.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_proposal_content_versions '
      +'(id,workspace_key,proposal_id,revision,title,scope_text,currency,'
      +'amount_minor,content_sha256,source_event_id,snapshot_kind,review_note,recorded_by) '
      +"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reviewed_revision',$11,$12)",
      [newSnapshotId,who.key,data.proposal_id,next,current.title,
       data.scope_text,current.currency,current.amount_minor,
       newHash,eventId,data.review_note,who.actor]
    );
    await client.query('COMMIT');
    inTx=false;
    return {
      id:data.proposal_id,company_id:data.company_id,
      opportunity_id:data.opportunity_id,revision:next,
      previous_revision:data.expected_revision,
      previous_snapshot_id:oldSnapshotId,new_snapshot_id:newSnapshotId,
      previous_content_sha256:originalDigest,content_sha256:newHash,
      currency:current.currency,amount_minor:Number(current.amount_minor),
      notice:'Reviewed internal scope correction saved with both full-text revisions. No message or quote sent.'
    };
  }catch(error){
    if(inTx)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
export async function readCompanyProposalContentVersions(pool,request,actor){
  if(!request||typeof request!=='object'||Array.isArray(request))
    throw new Error('CRM invalid revision history request');
  const id=requireId(request.proposal_id,'proposal');
  const company=requireCompanyId(request.company_id);
  const who=owner(actor);
  const client=await pool.connect();
  let inTx=false;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTx=true;
    const current=(await client.query(
      'SELECT d.id,d.revision,d.currency,d.amount_minor '
      +'FROM enkyron_crm_proposal_drafts d '
      +'JOIN enkyron_crm_opportunities o '
      +'ON o.workspace_key=d.workspace_key AND o.id=d.opportunity_id '
      +'WHERE d.workspace_key=$1 AND d.id=$2 AND o.company_id=$3 '
      +'AND o.source_ticket_id IS NULL',
      [who.key,id,company]
    )).rows[0];
    if(!current)throw new Error('CRM proposal not linked to this local company');
    const versions=(await client.query(
      'SELECT id,revision,title,scope_text,currency,amount_minor,'
      +'content_sha256,source_event_id,snapshot_kind,review_note,recorded_by,recorded_at '
      +'FROM enkyron_crm_proposal_content_versions '
      +'WHERE workspace_key=$1 AND proposal_id=$2 ORDER BY revision LIMIT 31',
      [who.key,id]
    )).rows;
    if(versions.length>30)
      throw new Error('CRM revision history exceeds bounded display');
    await client.query('COMMIT');
    inTx=false;
    return {available:true,proposal_id:id,company_id:company,
      current_revision:current.revision,versions};
  }catch(error){
    if(inTx)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
