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
    if(Object.hasOwn(payload,'correction') && typeof payload.correction!=='boolean')
      refused('correction must be an explicit boolean');
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
    title:String(item.controlTitle||item.controlId).slice(0,220),
    category:String(item.category||'').slice(0,100),
    suggested_by_arl:item.suggested?.level==='suggested',
    chain_status:String(item.chainStatus||'unknown').slice(0,100),
    next_action:String(item.nextAction||'').slice(0,500)};
}

/**
 * Read-only source preparation from the existing ARL frozen Inspector.
 * This is a cross-control technical brief, NOT 108 applicability verdicts.
 * No database changes, provider calls, active tools or model conclusions.
 */
export async function prepareTicketSourceReview(pool,ticketId,{
  inspector=null,scopeReader=readLinkedAssessmentContext
}={}) {
  if(!UUID.test(ticketId||''))refused('valid ticket required for source review');
  const scope=await scopeReader(pool,ticketId);
  const runInspector=inspector || (await import('../src/agent/tools/inspect-frozen-repository.mjs')).inspectFrozenRepository;
  const frozen=await runInspector(scope.target_reference);
  const bundle=frozen?.inspection;
  if(frozen?.type!=='frozen_inspection' ||
     frozen?.binding?.verified!==true ||
     frozen?.target?.dirty!==false ||
     frozen?.target?.revision!==scope.target_sha ||
     frozen?.binding?.revisionBefore!==scope.target_sha ||
     frozen?.binding?.revisionAfter!==scope.target_sha ||
     bundle?.schema!=='arl.inspection.bundle.v1' ||
     bundle?.scope?.mode!=='read-only-static-inspection' ||
     !Array.isArray(bundle.findings))
    refused('source inspection has no verified exact-SHA binding');
  const current=await scopeReader(pool,ticketId);
  if(current.snapshot_id!==scope.snapshot_id ||
     current.project_id!==scope.project_id ||
     current.target_sha!==scope.target_sha)
    refused('assessment changed while the source was inspected');
  const safeInteger=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  const findings=bundle.findings.slice(0,5).map(f=>({
    rule_id:String(f.ruleId||'').slice(0,48),
    title:String(f.title||'').slice(0,160),
    severity:String(f.severity||'').slice(0,20)
  }));
  return {
    available:true,ticket_id:ticketId,snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    scanner_version:String(bundle.scanner?.version||'').slice(0,40),
    files_inspected:safeInteger(bundle.scope?.filesInspected),
    files_discovered:safeInteger(bundle.scope?.filesDiscovered),
    truncated:bundle.scope?.truncatedByLimit===true,
    candidate_count:bundle.findings.length,observations:findings,
    scope:'frozen_source_only',
    decisions_recorded:0,security_verdict:false,tests_executed:0,
    human_review_required:true,
    notice:'Prepared by ARL frozen source Inspector. Candidate observations are NOT validated findings or control applicability decisions. Declared purpose, architecture, permissions and change approval still require human evidence.'
  };
}

export function shapeFullLocalControlQueue(page,scope){
  assertSnapshot(page?.systemSnapshot?.id,scope);
  if(page?.total!==108 || page?.hasMore!==false ||
     page?.limit!==108 || page?.offset!==0 ||
     !Array.isArray(page.items) || page.items.length!==108)
    refused('incomplete canonical 108-control registry');
  const items=[], seen=new Set();
  for(const original of page.items){
    const item=safeControlItem(original);
    if(seen.has(item.control_id))refused('duplicate canonical control ID');
    seen.add(item.control_id);
    items.push(item);
  }
  if(items.length!==108)refused('partial current-snapshot control queue');
  const stages=Object.fromEntries([...VALID_STAGE].map(stage=>
    [stage,items.filter(item=>item.stage===stage).length]));
  return {available:true,project_id:scope.project_id,
    assessment_id:scope.assessment_id,snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,total:108,stages,items,
    human_review_required:true,tests_executed:0,
    notice:'Select one control. No applicability decision is inferred or recorded by inspection.'};
}

export async function readTicketControlQueue(pool,ticketId){
  const {scope,binding}=await canonicalControlBinding(pool,ticketId);
  const [{getControlIntelligence},{LOCAL_OPERATOR_FULL_QUEUE}]=await Promise.all([
    controlApi(), import('../src/agent/local-operator-full-queue.mjs')
  ]);
  // One full canonical graph derivation. The Symbol is an in-process
  // capability, not a public API flag; the core still enforces role access,
  // snapshot integrity and the public 50-control pagination limit.
  const page=await getControlIntelligence({
    projectId:binding.projectId,userId:binding.userId,limit:108,offset:0,
    [LOCAL_OPERATOR_FULL_QUEUE]:true
  });
  const queue=shapeFullLocalControlQueue(page,scope);
  const after=await readLinkedAssessmentContext(pool,ticketId);
  if(after.snapshot_id!==scope.snapshot_id || after.target_sha!==scope.target_sha ||
     after.project_id!==scope.project_id || after.assessment_id!==scope.assessment_id)
    refused('target changed during review');
  return {...queue,ticket_id:ticketId};
}

/**
 * A human can amend an applicability revision before ANY downstream control
 * activity. Historical revision rows are never rewritten or deleted.
 * This is NOT a way to override observed tests, evidence or findings.
 */
export function canCorrectApplicability(detail){
  if(detail?.chain?.currentStage!=='test' ||
     detail?.applicability?.status!=='applicable' ||
     !Array.isArray(detail?.applicability?.history) ||
     detail.applicability.history.length<1)return false;
  const downstream=['tests','testHistory','evidence','evidenceHistory',
    'findings','remediation','runtimeDecisions','approvals','retests'];
  return downstream.every(key=>
    detail[key]===undefined || (Array.isArray(detail[key]) && detail[key].length===0));
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
    applicability_reason:String(detail.applicability?.reason||'').slice(0,1800),
    correction_allowed:canCorrectApplicability(detail),
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
  const correction=payload.correction===true;
  const allowedStage=correction
    ? (current.stage==='test' && current.correction_allowed===true)
    : current.stage==='applicability';
  if(current.snapshot_id!==payload.snapshot_id ||
     current.evaluation_digest!==payload.evaluation_digest ||
     !allowedStage)refused('stale review, downstream activity or correction not authorised');
  if(current.stage==='test' && payload.reason.trim()===current.applicability_reason.trim())
    refused('correction must change the recorded explanation');
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
    correction,
    revision_id:recorded.evaluation.id,
    next_stage:recorded.controlStatus?.currentStage||'unknown',
    notice:correction
      ? 'Corrective applicability revision appended; original preserved in canonical history. No evidence accepted, test run or verdict decided.'
      : 'Canonical human applicability revision recorded. No evidence accepted, test run or verdict decided.'};
}
