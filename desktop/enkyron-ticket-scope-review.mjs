// ENKYRON documentary scope / owner-permission review for the current frozen assessment.
// No active test authorisation, no evidence acceptance, no canonical security decisions.
import {randomUUID} from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';
import {readLinkedAssessmentContext, frozenLocalTarget} from './enkyron-ticket-assessment.mjs';

const SHA=/^[a-f0-9]{40}$/;
const FIELDS={
  technical_owner:[2,160],
  owner_authority_basis:[20,1000],
  included_scope:[30,3000],
  excluded_scope:[15,2000],
  environment:[5,500],
  permitted_methods:[20,2000],
  prohibited_methods:[20,2000],
  rules_of_engagement:[40,3000],
  rationale:[30,1200]
};
const DECISIONS=new Set([
  'scope_draft','read_only_scope_reviewed','active_test_authorisation_pending'
]);
const bad=msg=>{throw Error('Technical scope review: '+msg);};
function str(v,name,min,max){
  if(typeof v!=='string'||/\x00|[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||
     v.trim().length<min||v.trim().length>max)bad(name+' must be '+min+'–'+max+' characters');
  return v.trim();
}
export function validateScopeReview(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>![
       'ticket_id','snapshot_id','target_sha','expected_revision','decision',
       ...Object.keys(FIELDS),'owner_permission_reference','confirmed'
     ].includes(k)))bad('invalid request fields');
  const ticket_id=requireTicketId(input.ticket_id);
  if(!/^sys_[A-Za-z0-9_-]{8,100}$/.test(input.snapshot_id||'') ||
     !SHA.test(input.target_sha||''))bad('current snapshot and exact Git SHA required');
  if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0)
    bad('expected revision required');
  if(!DECISIONS.has(input.decision))bad('unsupported authorisation status');
  if(input.confirmed!==true)bad('explicit accountable human confirmation required');
  const values=Object.fromEntries(Object.entries(FIELDS).map(([k,[min,max]])=>
    [k,str(input[k],k,min,max)]
  ));
  const ref=str(input.owner_permission_reference??'','owner_permission_reference',0,500);
  if(input.decision==='active_test_authorisation_pending' && ref.length<8)
    bad('active-test request requires an identifiable owner permission reference');
  return {ticket_id,snapshot_id:input.snapshot_id,target_sha:input.target_sha,
    expected_revision:input.expected_revision,decision:input.decision,...values,
    owner_permission_reference:ref};
}

function operator(ticket,actor){
  if(!ticket || ticket.archived_at || ticket.status==='closed' ||
     ticket.assigned_to!==actor || ticket.assessor_name!==actor ||
     ticket.target_kind!=='git' || !ticket.linked_project_id || !ticket.linked_assessment_id)
    bad('open linked ticket and its assigned local operator are required');
}
function snapshotMatches(s,record){
  return record?.project_id===s.project_id &&
    record?.assessment_id===s.assessment_id &&
    record?.system_snapshot_id===s.snapshot_id &&
    record?.target_sha===s.target_sha;
}
export async function readTicketScopeReview(pool,ticketId,actor,{
  scopeReader=readLinkedAssessmentContext
}={}){
  requireTicketId(ticketId);
  const ticket=(await pool.query(
    'SELECT id,assigned_to,assessor_name,archived_at,status,target_kind,linked_project_id,linked_assessment_id FROM arl_workbench_tickets WHERE id=$1',
    [ticketId])).rows[0];
  operator(ticket,actor);
  const s=await scopeReader(pool,ticketId);
  if(s.project_id!==ticket.linked_project_id || s.assessment_id!==ticket.linked_assessment_id)
    bad('frozen linked assessment does not match the ticket');
  let record=null;
  try{
    record=(await pool.query(
      'SELECT * FROM enkyron_ticket_scope_reviews WHERE ticket_id=$1 ORDER BY revision DESC LIMIT 1',
      [ticketId])).rows[0]||null;
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Technical scope review schema 114 is not installed; no records changed.',
      tests_authorised:false};
    throw error;
  }
  return {available:true,ticket_id:ticketId,project_id:s.project_id,
    assessment_id:s.assessment_id,snapshot_id:s.snapshot_id,target_sha:s.target_sha,
    latest:record,expected_revision:record?.revision??0,
    current_revision_binding:record?snapshotMatches(s,record):null,
    tests_authorised:false,evidence_accepted:false,
    notice:record && !snapshotMatches(s,record)
      ? 'Scope review refers to an older snapshot; record a fresh review. Active tests remain blocked.'
      : 'Documentary owner/scope review only. A verified, control-specific canonical active-test plan is required separately; this page never grants test execution.'};
}

export async function recordTicketScopeReview(pool,input,actor,{
  scopeReader=readLinkedAssessmentContext,
  uuid=randomUUID
}={}){
  const v=validateScopeReview(input);
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    bad('invalid local operator');
  const verified=await scopeReader(pool,v.ticket_id);
  if(verified.snapshot_id!==v.snapshot_id||verified.target_sha!==v.target_sha)
    bad('frozen scope changed since review; reload');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const t=(await client.query(
      'SELECT * FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [v.ticket_id])).rows[0];
    operator(t,actor);
    if(t.linked_project_id!==verified.project_id||
       t.linked_assessment_id!==verified.assessment_id||
       t.target_reference!==verified.target_reference)
      bad('ticket-to-assessment link changed');
    const target=frozenLocalTarget(t.target_reference);
    if(target.sha!==v.target_sha)bad('frozen Git revision changed');
    const snapshots=(await client.query(
      "SELECT id,project_id,assessment_configuration_json FROM system_snapshots "+
      "WHERE project_id=$1 AND status='current' FOR SHARE",
      [verified.project_id])).rows;
    if(snapshots.length!==1 || snapshots[0].id!==v.snapshot_id ||
       snapshots[0].project_id!==verified.project_id)
      bad('current snapshot changed');
    const config=typeof snapshots[0].assessment_configuration_json==='string'
      ? JSON.parse(snapshots[0].assessment_configuration_json)
      : snapshots[0].assessment_configuration_json;
    if(config?.assessmentBinding?.assessmentId!==verified.assessment_id ||
       config?.targetBinding?.revision!==v.target_sha)
      bad('canonical snapshot/assessment SHA mismatch');
    const old=(await client.query(
      'SELECT revision FROM enkyron_ticket_scope_reviews WHERE ticket_id=$1 ORDER BY revision DESC LIMIT 1',
      [v.ticket_id])).rows[0];
    const revision=old?.revision??0;
    if(revision!==v.expected_revision)
      bad('concurrent review recorded; reopen the current revision');
    const id=uuid();
    const saved=(await client.query(
      'INSERT INTO enkyron_ticket_scope_reviews '+
      '(id,ticket_id,revision,project_id,assessment_id,system_snapshot_id,target_sha,'+
      'decision,technical_owner,owner_authority_basis,included_scope,excluded_scope,'+
      'environment,permitted_methods,prohibited_methods,rules_of_engagement,'+
      'owner_permission_reference,rationale,recorded_by) '+
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) '+
      'RETURNING id,revision,recorded_at',
      [id,v.ticket_id,revision+1,verified.project_id,verified.assessment_id,
       v.snapshot_id,v.target_sha,v.decision,v.technical_owner,v.owner_authority_basis,
       v.included_scope,v.excluded_scope,v.environment,v.permitted_methods,
       v.prohibited_methods,v.rules_of_engagement,v.owner_permission_reference,
       v.rationale,actor])).rows[0];
    if(!saved)bad('scope review was not recorded');
    await client.query('COMMIT');
    return {saved:true,review_id:saved.id,revision:saved.revision,
      recorded_at:saved.recorded_at,snapshot_id:v.snapshot_id,target_sha:v.target_sha,
      decision:v.decision,tests_authorised:false,evidence_accepted:false,
      notice:'Scope review saved as immutable history. No active test approval or control verdict. Verify individual active-test evidence through canonical ARL.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
