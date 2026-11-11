// Canonical per-control human applicability review for ENKYRON.
// No artificial scope skips, no test execution, no automatic decisions.
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CONTROL=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const DIGEST=/^[a-f0-9]{64}$/;
const VALID_STAGE=new Set(['applicability','test','evidence','finding','remediation','retest','approval','deployment_decision']);
const DECISIONS=new Set(['applicable','not_applicable','context_required']);
const refused=reason=>{throw new Error('Control review: '+reason);};

export function validateControlReviewRequest(payload,{decision=false}={}) {
  if(!payload || typeof payload!=='object' || Array.isArray(payload) ||
     !UUID.test(payload.ticket_id||'') || !CONTROL.test(payload.control_id||'')) {
    refused('an exact ticket and ARL-KB-001 through ARL-KB-108 are required');
  }
  if(decision){
    if(payload.confirmed!==true || !DECISIONS.has(payload.decision) ||
       typeof payload.reason!=='string' || payload.reason.trim().length<20 ||
       payload.reason.length>1800 || !DIGEST.test(payload.evaluation_digest||'') ||
       typeof payload.snapshot_id!=='string' ||
       !/^sys_[A-Za-z0-9_-]{8,100}$/.test(payload.snapshot_id) ||
       !Array.isArray(payload.architecture_fact_ids) ||
       payload.architecture_fact_ids.length>20 ||
       payload.architecture_fact_ids.some(x=>typeof x!=='string'||x.length>100)){
      refused('exact snapshot, digest, decision, reason and explicit confirmation required');
    }
    if(payload.decision==='not_applicable' && !payload.architecture_fact_ids.length){
      refused('Not applicable requires confirmed architecture facts. Document the architecture first.');
    }
  }
  return {ticketId:payload.ticket_id,controlId:payload.control_id};
}

export async function canonicalControlBinding(pool,ticketId){
  if(!UUID.test(ticketId||''))refused('valid ticket required');
  const scope=await readLinkedAssessmentContext(pool,ticketId);
  // ENKYRON itself connects through the local Unix socket; the canonical
  // ARL Control Intelligence adapter requires DATABASE_URL. The same
  // product .env already used by assess:local is loaded only for this
  // explicitly requested control operation, before importing src/db.js.
  if(!process.env.DATABASE_URL?.trim()){
    try{process.loadEnvFile?.(new URL('../.env',import.meta.url).pathname);}
    catch(error){if(error?.code!=='ENOENT')throw error;}
  }
  if(!process.env.DATABASE_URL?.trim())
    refused('canonical PostgreSQL DATABASE_URL is not configured');
  process.env.ARL_LOCAL_MODE='1';
  const [{enableLocalCliMode},{findExistingLocalAssessmentContext}] = await Promise.all([
    import('../src/agent/local-cli-mode.mjs'),
    import('../src/agent/local-assessment-context.mjs')
  ]);
  enableLocalCliMode(process.env);
  const binding=await findExistingLocalAssessmentContext(scope.target_reference);
  if(!binding || binding.projectId!==scope.project_id ||
     binding.assessmentId!==scope.assessment_id)
    refused('local ARL authority does not match the linked ticket');
  return {scope,binding};
}

function controlApi(){
  return import('../src/control-intelligence.js');
}

function assertSnapshot(snapshotId,scope){
  if(snapshotId!==scope.snapshot_id) refused('snapshot has changed — reopen control review');
}

function safeControlItem(item){
  if(!CONTROL.test(item?.controlId||'') || !VALID_STAGE.has(item?.currentStage))
    refused('unexpected canonical control identity or workflow stage');
  return {control_id:item.controlId,stage:item.currentStage,
    chain_status:String(item.chainStatus||'unknown').slice(0,100),
    next_action:String(item.nextAction||'').slice(0,500)};
}

export async function readTicketControlQueue(pool,ticketId){
  const {scope,binding}=await canonicalControlBinding(pool,ticketId);
  const {getControlIntelligence}=await controlApi();
  const items=[], seen=new Set();
  for(let offset=0;offset<150;offset+=50){
    const page=await getControlIntelligence({
      projectId:binding.projectId,userId:binding.userId,limit:50,offset});
    assertSnapshot(page?.systemSnapshot?.id,scope);
    if(page.total!==108 || !Array.isArray(page.items))refused('incomplete canonical 108-control registry');
    for(const original of page.items){
      const item=safeControlItem(original);
      if(seen.has(item.control_id))refused('duplicate canonical control ID');
      seen.add(item.control_id);items.push(item);
    }
    if(!page.hasMore)break;
  }
  if(items.length!==108)refused('partial current-snapshot control queue');
  const after=await readLinkedAssessmentContext(pool,ticketId);
  if(after.snapshot_id!==scope.snapshot_id || after.target_sha!==scope.target_sha)
    refused('target changed during review');
  const stages=Object.fromEntries([...VALID_STAGE].map(stage=>
    [stage,items.filter(item=>item.stage===stage).length]));
  return {available:true,ticket_id:ticketId,project_id:scope.project_id,
    assessment_id:scope.assessment_id,snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,total:108,stages,items,
    human_review_required:true,tests_executed:0,
    notice:'Select one control. No applicability decision is inferred or recorded by inspection.'};
}

export async function readTicketControlDetail(pool,payload){
  const {ticketId,controlId}=validateControlReviewRequest(payload);
  const {scope,binding}=await canonicalControlBinding(pool,ticketId);
  const {getControlIntelligenceControl}=await controlApi();
  const detail=await getControlIntelligenceControl({
    projectId:binding.projectId,controlId,userId:binding.userId});
  assertSnapshot(detail?.systemSnapshot?.id,scope);
  if(detail?.control?.id!==controlId)refused('control identity mismatch');
  const stage=detail?.chain?.currentStage;
  if(!VALID_STAGE.has(stage))refused('unexpected current control stage');
  const result={
    available:true,ticket_id:ticketId,control_id:controlId,
    project_id:scope.project_id,snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    title:String(detail.control.title||'').slice(0,250),
    category:String(detail.control.category||'').slice(0,140),
    stage,chain_status:String(detail.chain.chainStatus||'').slice(0,100),
    next_action:String(detail.chain.nextAction||'').slice(0,900),
    applicability_status:String(detail.applicability?.status||'unknown').slice(0,50),
    applicability_reason:String(detail.applicability?.reason||'').slice(0,1200),
    evaluation_digest:String(detail.applicability?.evaluationDigest||''),
    check_objective:String(detail.testDefinition?.objective||'').slice(0,1500),
    check_method:String(detail.testDefinition?.method||'').slice(0,1200),
    confirmed_facts:Array.isArray(detail.architectureFacts)
      ? detail.architectureFacts.filter(x=>typeof x==='string').slice(0,100) : [],
    human_review_required:true,tests_executed:0
  };
  if(!DIGEST.test(result.evaluation_digest))refused('missing canonical optimistic concurrency token');
  return result;
}

export async function recordTicketControlApplicability(pool,payload,actor){
  const {ticketId,controlId}=validateControlReviewRequest(payload,{decision:true});
  const ownership=await pool.query(
    `SELECT assigned_to,assessor_name,status,archived_at
       FROM arl_workbench_tickets WHERE id=$1`,[ticketId]);
  const ticket=ownership.rows[0];
  if(!ticket || ticket.archived_at || ticket.status==='closed' ||
     ticket.assigned_to!==actor || ticket.assessor_name!==actor)
    refused('active ticket assignment and original accountable operator required');
  const current=await readTicketControlDetail(pool,payload);
  if(current.snapshot_id!==payload.snapshot_id ||
     current.evaluation_digest!==payload.evaluation_digest ||
     current.stage!=='applicability')refused('stale review or control no longer at applicability');
  if(payload.architecture_fact_ids.some(f=>!current.confirmed_facts.includes(f)))
    refused('facts must be confirmed in the current canonical snapshot');
  const {scope,binding}=await canonicalControlBinding(pool,ticketId);
  if(scope.snapshot_id!==current.snapshot_id)refused('snapshot changed');
  const {assessControlApplicability}=await controlApi();
  const recorded=await assessControlApplicability({
    projectId:binding.projectId,userId:binding.userId,controlId,
    input:{
      snapshotId:scope.snapshot_id,decision:payload.decision,
      reason:payload.reason.trim(),
      architectureFactIds:payload.architecture_fact_ids,
      expectedEvaluationDigest:payload.evaluation_digest
    }
  });
  if(recorded?.evaluation?.controlId!==controlId ||
     recorded.evaluation.systemSnapshotId!==scope.snapshot_id ||
     recorded.evaluation.decision!==payload.decision)
    refused('canonical review write could not be verified; inspect current state');
  return {saved:true,control_id:controlId,
    snapshot_id:scope.snapshot_id,decision:recorded.evaluation.decision,
    revision_id:recorded.evaluation.id,
    next_stage:recorded.controlStatus?.currentStage||'unknown',
    notice:'Canonical human applicability revision recorded. No evidence accepted, test run or verdict decided.'};
}
