import crypto from 'node:crypto';
import { db, id, nowIso } from './db.js';
import { getSeveritySemantics } from './risk-knowledge-core.js';
import { runtimeApprovalActionDigest } from './access-control.js';
import { ARCHITECTURE_FACTS, suggestControls, suggestionProfile } from './control-suggestions.js';

const VIEW_ROLES = new Set(['viewer','analyst','developer','admin','owner']);
const RECORD_ROLES = new Set(['analyst','developer','admin','owner']);
const SNAPSHOT_ROLES = new Set(['developer','admin','owner']);
const DECISION_ROLES = new Set(['admin','owner']);
const EVIDENCE_CLASSES = new Set(['declared','observed','test_generated','runtime','human_provided','imported']);
const SENSITIVITY = new Set(['public','internal','confidential','restricted']);
const SAFE_SNAPSHOT_KEYS = new Set(['architecture','models','tools','identities','dataSources','networkAccess','autonomyLevel','approvalConfiguration','assessmentConfiguration','source','expectedCurrentSnapshotId']);
const SECRET_KEY = /(?:password|secret|token|api.?key|private.?key|credential)/i;
const APPLICABILITY_DECISIONS = new Set(['applicable','not_applicable','context_required']);
const BULK_APPLICABILITY_LIMIT = 20;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function intelligenceDigest(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }

export async function createSystemSnapshot({ projectId, userId, input = {} }) {
  validateSnapshotInput(input);
  let result;
  await db.transaction(async () => {
    const access = await requireAccess(projectId, userId, SNAPSHOT_ROLES, true);
    const project = access.project;
    const payload = snapshotDescriptor({ project, input });
    rejectSensitive(payload);
    if (Buffer.byteLength(canonicalJson(payload)) > 262144) throw badRequest('System snapshot exceeds the 256 KiB safe limit.');
    const contentDigest = intelligenceDigest(payload);
    const existing = await db.prepare('SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND content_digest=?').get(project.workspace_id, projectId, contentDigest);
    if (existing) { await verifySnapshot(existing); result = { snapshot: serializeSnapshot(existing), created: false }; return; }
    const current = await db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current'").get(project.workspace_id, projectId);
    if (input.expectedCurrentSnapshotId != null && clean(input.expectedCurrentSnapshotId,100) !== (current?.id || '')) throw conflict('The system snapshot changed after this page was loaded. Reload and reassess before replacing it.');
    const timestamp = nowIso();
    const snapshotId = id('sys_');
    const count = Number((await db.prepare('SELECT COUNT(*) count FROM system_snapshots WHERE workspace_id=? AND project_id=?').get(project.workspace_id, projectId)).count || 0);
    await db.prepare("UPDATE system_snapshots SET status='superseded' WHERE project_id=? AND status='current'").run(projectId);
    await db.prepare("UPDATE control_snapshot_evaluations SET stale_at=? WHERE project_id=? AND stale_at IS NULL").run(timestamp, projectId);
    await db.prepare("UPDATE control_deployment_decisions SET status='stale',reassessment_trigger='material_system_snapshot_change' WHERE project_id=? AND status='current'").run(projectId);
    await db.prepare(`INSERT INTO system_snapshots
      (id,workspace_id,project_id,version_identifier,status,architecture_json,models_json,tools_json,identities_json,data_sources_json,network_access_json,autonomy_level,approval_configuration_json,runtime_policy_version,runtime_policy_digest,assessment_configuration_json,content_digest,source,created_by,created_at,descriptor_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(snapshotId, project.workspace_id, projectId, `v${count + 1}`,'current',
      JSON.stringify(payload.architecture), JSON.stringify(payload.models), JSON.stringify(payload.tools), JSON.stringify(payload.identities),
      JSON.stringify(payload.dataSources), JSON.stringify(payload.networkAccess), payload.autonomyLevel, JSON.stringify(payload.approvalConfiguration),
      payload.runtimePolicyVersion, payload.runtimePolicyDigest, JSON.stringify(payload.assessmentConfiguration), contentDigest, payload.source, userId, timestamp, canonicalJson(payload));
    await bindControlEvaluations({ access, snapshotId, userId, timestamp });
    await bindApprovalRequirements({access,snapshotId,userId,timestamp,payload});
    await bindRuntimeMappings({access,snapshotId,userId,timestamp,payload});
    await audit(access, userId, 'control_intelligence.snapshot_created', 'system_snapshot', snapshotId, { contentDigest, version: `v${count + 1}` });
    result = { snapshot: serializeSnapshot(await db.prepare('SELECT * FROM system_snapshots WHERE id=?').get(snapshotId)), created: true };
  });
  return result;
}

export async function assessControlApplicability({projectId,controlId,userId,input={}}) {
  let output;
  await db.transaction(async()=>{
    const access=await requireAccess(projectId,userId,RECORD_ROLES,true);const snapshot=await requireCurrentSnapshot(access,input.snapshotId);
    output=await writeApplicability({access,snapshot,controlId,userId,input});
  });
  const detail=await getControlIntelligenceControl({projectId,controlId,userId});return {evaluation:output,controlStatus:detail.chain,projectProgress:(await getControlIntelligence({projectId,userId,limit:1})).summary};
}

export async function assessControlApplicabilityBatch({projectId,userId,input={}}){
  for(const key of ['workspaceId','evaluatorId','evaluatorRole','evaluatedAt','profileVersion','suggestionProfileDigest','severity'])if(Object.hasOwn(input,key))throw badRequest(`Caller-supplied ${key} is not accepted.`);
  const items=Array.isArray(input.items)?input.items:[];if(!items.length||items.length>BULK_APPLICABILITY_LIMIT)throw badRequest(`Bulk applicability requires 1 to ${BULK_APPLICABILITY_LIMIT} controls.`);
  const ids=items.map(item=>clean(item?.controlId,80));if(new Set(ids).size!==ids.length)throw badRequest('Duplicate control IDs are not allowed in one bulk review.');
  let evaluations,snapshotId;
  await db.transaction(async()=>{const access=await requireAccess(projectId,userId,RECORD_ROLES,true);const snapshot=await requireCurrentSnapshot(access,input.snapshotId);snapshotId=snapshot.id;if(clean(input.expectedSnapshotDigest,64)!==snapshot.content_digest)throw conflict('The system snapshot changed after this bulk review loaded. Reload before saving.');evaluations=[];for(const item of items){if(!/^[a-f0-9]{64}$/.test(String(item.expectedEvaluationDigest||'')))throw conflict(`Control ${clean(item.controlId,80)} changed or lacks an optimistic concurrency token. Reload before saving.`);const missingInformation=clean(item.missingInformation,1000);if(item.decision==='context_required'&&missingInformation.length<10)throw badRequest(`Control ${clean(item.controlId,80)} must identify the missing architecture information.`);const assessedInput={...item,reason:item.decision==='context_required'?`${clean(item.reason,1000)} Missing information: ${missingInformation}`:item.reason};delete assessedInput.missingInformation;evaluations.push(await writeApplicability({access,snapshot,controlId:item.controlId,userId,input:assessedInput}));}await audit(access,userId,'control_intelligence.applicability_bulk_assessed','system_snapshot',snapshot.id,{controlIds:ids,count:ids.length});});
  return {snapshotId,evaluations,count:evaluations.length,projectProgress:(await getControlIntelligence({projectId,userId,limit:1})).summary};
}

async function writeApplicability({access,snapshot,controlId,userId,input}){
  for(const key of ['workspaceId','projectId','systemSnapshotId','evaluatorId','evaluatorRole','evaluatedAt','evaluationDigest','profileVersion','controlDigest','severity','chainStatus','nextAction','suggestionLevel','suggestionRationale','suggestionProfileDigest'])if(Object.hasOwn(input,key))throw badRequest(`Caller-supplied ${key} is not accepted.`);
  const decision=clean(input.decision,30),reason=clean(input.reason,2000),facts=[...new Set((Array.isArray(input.architectureFactIds)?input.architectureFactIds:[]).map(value=>clean(value,100)).filter(Boolean))].sort();
  if(!APPLICABILITY_DECISIONS.has(decision))throw badRequest('Decision must be applicable, not_applicable or context_required.');if(reason.length<10||/^(not relevant|not applicable|n\/a|none)$/i.test(reason))throw badRequest('A specific control-level applicability reason of at least 10 characters is required.');if(decision==='not_applicable'&&(!/\b(?:no|absent|disabled|cannot|never|without|does not|not configured)\b/i.test(reason)||!/\b(?:agent|system|capability|input|data|tool|access|authority|identity|network|boundary|action)\b/i.test(reason)))throw badRequest('Not-applicable reasons must identify the absent capability, data, authority, identity or trust boundary.');if(!facts.length)throw badRequest('Select at least one supporting or missing architecture fact.');const snapshotFactsSet=new Set(snapshotFacts(snapshot));if(facts.some(fact=>!ARCHITECTURE_FACTS.includes(fact)||!snapshotFactsSet.has(fact)))throw badRequest('Architecture facts must be confirmed facts from the current snapshot.');
  const evaluation=await db.prepare('SELECT * FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?').get(access.project.workspace_id,access.project.id,snapshot.id,clean(controlId,80));if(!evaluation)throw notFound('Current snapshot control evaluation not found.');const previous=await db.prepare('SELECT * FROM control_applicability_revisions WHERE evaluation_id=? ORDER BY evaluated_at DESC,id DESC LIMIT 1').get(evaluation.id);const expected=clean(input.expectedEvaluationDigest,64);if(expected&&expected!==(previous?.evaluation_digest||evaluation.content_digest))throw conflict('Applicability changed after this page loaded. Reload before saving.');
  const timestamp=nowIso(),descriptor={schema:'arl.control-applicability.v1',workspaceId:access.project.workspace_id,projectId:access.project.id,systemSnapshotId:snapshot.id,evaluationId:evaluation.id,controlId:evaluation.entry_id,controlProfileVersion:evaluation.control_profile_version,controlDigest:evaluation.entry_digest,decision,reason,architectureFactIds:facts,evaluatorId:userId,evaluatorRole:access.role,evaluatedAt:timestamp,previousRevisionId:previous?.id||null},digest=intelligenceDigest(descriptor),revisionId=id('cap_');await db.prepare(`INSERT INTO control_applicability_revisions (id,workspace_id,project_id,system_snapshot_id,evaluation_id,entry_id,decision,reason,architecture_facts_json,evaluator_id,evaluator_role,evaluated_at,previous_revision_id,descriptor_json,evaluation_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(revisionId,access.project.workspace_id,access.project.id,snapshot.id,evaluation.id,evaluation.entry_id,decision,reason,canonicalJson(facts),userId,access.role,timestamp,previous?.id||null,canonicalJson(descriptor),digest);
  const storedDecision=decision==='context_required'?'unknown':decision,semantics=getSeveritySemantics({scope:'project',applicability:storedDecision,evaluatedSeverity:null}),currentDescriptor={...descriptorFromEvaluation(evaluation),applicabilityStatus:storedDecision,applicabilityReason:reason,contextualSeverity:null,severityStatus:semantics.severityStatus,evaluatorId:userId,decisionMethod:'guided_customer_review',evaluatedAt:timestamp};await db.prepare('UPDATE control_snapshot_evaluations SET applicability_status=?,applicability_reason=?,contextual_severity=NULL,severity_status=?,evaluator_id=?,decision_method=?,evaluated_at=?,descriptor_json=?,content_digest=? WHERE id=?').run(storedDecision,reason,semantics.severityStatus,userId,'guided_customer_review',timestamp,canonicalJson(currentDescriptor),intelligenceDigest(currentDescriptor),evaluation.id);await audit(access,userId,'control_intelligence.applicability_assessed','control_evaluation',evaluation.id,{controlId:evaluation.entry_id,previousState:previous?.decision||'context_required',newState:decision,revisionId});return{id:revisionId,systemSnapshotId:snapshot.id,controlId:evaluation.entry_id,decision,reason,architectureFactIds:facts,evaluator:{id:userId,role:access.role},evaluatedAt:timestamp,evaluationDigest:digest,previousRevisionId:previous?.id||null};
}

async function bindRuntimeMappings({access,snapshotId,userId,timestamp,payload}){
  const mappings=Array.isArray(payload.approvalConfiguration?.runtimeControlMappings)?payload.approvalConfiguration.runtimeControlMappings:[];
  for(const item of mappings){const entryId=clean(item?.controlId,80);const ruleId=clean(item?.ruleId,160);if(!entryId||!ruleId)throw badRequest('Runtime control mapping requires a control and server rule ID.');const evaluation=await db.prepare('SELECT id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?').get(access.project.workspace_id,access.project.id,snapshotId,entryId);if(!evaluation||!payload.runtimePolicyVersion||!payload.runtimePolicyDigest)throw badRequest('Runtime control mapping requires a current control and published runtime policy.');const descriptor={schema:'arl.runtime-control-mapping.v1',workspaceId:access.project.workspace_id,projectId:access.project.id,systemSnapshotId:snapshotId,entryId,ruleId,policyVersion:payload.runtimePolicyVersion,policyDigest:payload.runtimePolicyDigest,createdBy:userId,createdAt:timestamp};await db.prepare(`INSERT INTO runtime_control_mappings (id,workspace_id,project_id,system_snapshot_id,entry_id,rule_id,policy_version,policy_digest,descriptor_json,mapping_digest,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('rcm_'),access.project.workspace_id,access.project.id,snapshotId,entryId,ruleId,payload.runtimePolicyVersion,payload.runtimePolicyDigest,canonicalJson(descriptor),intelligenceDigest(descriptor),userId,timestamp);}
}

async function bindApprovalRequirements({access,snapshotId,userId,timestamp,payload}) {
  const requirements=Array.isArray(payload.approvalConfiguration?.requiredActions)?payload.approvalConfiguration.requiredActions:[];
  for(const item of requirements){
    const entryId=clean(item?.controlId,80);const evaluation=await db.prepare('SELECT id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?').get(access.project.workspace_id,access.project.id,snapshotId,entryId);
    if(!evaluation)throw badRequest('Approval requirement references an unknown control.');
    const descriptor={schema:'arl.approval-requirement.v1',workspaceId:access.project.workspace_id,projectId:access.project.id,systemSnapshotId:snapshotId,controlId:entryId,action:clean(item.action,200).toLowerCase(),parameters:item.parameters||{},target:clean(item.target,300)||null,value:item.value??null,currency:clean(item.currency,12).toUpperCase()||null,actor:clean(item.actor,200)||null,policyVersion:payload.runtimePolicyVersion,policyDigest:payload.runtimePolicyDigest,validity:{reuseScope:item.reuseScope==='bounded_reuse'?'bounded_reuse':'one_time'}};
    if(!descriptor.action)throw badRequest('Approval requirement action is required.');rejectSensitive(descriptor);const actionDigest=intelligenceDigest({action:descriptor.action,parameters:descriptor.parameters,target:descriptor.target,value:descriptor.value,currency:descriptor.currency,actor:descriptor.actor,policyVersion:descriptor.policyVersion,policyDigest:descriptor.policyDigest});
    await db.prepare(`INSERT INTO control_approval_requirements (id,workspace_id,project_id,system_snapshot_id,entry_id,action_type,action_digest,policy_version,policy_digest,reuse_scope,descriptor_json,requirement_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('car_'),access.project.workspace_id,access.project.id,snapshotId,entryId,descriptor.action,actionDigest,descriptor.policyVersion,descriptor.policyDigest,descriptor.validity.reuseScope,canonicalJson(descriptor),intelligenceDigest(descriptor),timestamp);
  }
}

async function bindControlEvaluations({ access, snapshotId, userId, timestamp }) {
  const rows = await db.prepare(`SELECT e.id,e.knowledge_version,e.content_digest,s.applicability_status,s.applicability_reason,
      c.project_severity,c.assessed_by,c.assessed_at
    FROM risk_knowledge_entries e
    LEFT JOIN project_risk_knowledge_states s ON s.entry_id=e.id AND s.workspace_id=? AND s.project_id=?
    LEFT JOIN project_risk_context c ON c.entry_id=e.id AND c.workspace_id=? AND c.project_id=?
    WHERE e.status='active' ORDER BY e.id`).all(access.project.workspace_id, access.project.id, access.project.workspace_id, access.project.id);
  for (const row of rows) {
    const applicability = row.applicability_status || 'unknown';
    const semantics = getSeveritySemantics({ scope: 'project', applicability, evaluatedSeverity: row.project_severity === 'unassessed' ? null : row.project_severity });
    const descriptor={schema:'arl.control-evaluation.v1',workspaceId:access.project.workspace_id,projectId:access.project.id,systemSnapshotId:snapshotId,entryId:row.id,controlProfileVersion:row.knowledge_version,entryDigest:row.content_digest,applicabilityStatus:applicability,applicabilityReason:row.applicability_reason||'Architecture facts have not been assessed.',contextualSeverity:semantics.severity,severityStatus:semantics.severityStatus,evaluatorId:row.assessed_by||userId,decisionMethod:row.assessed_at?'project_risk_context':'snapshot_binding',evaluatedAt:row.assessed_at||timestamp};
    await db.prepare(`INSERT INTO control_snapshot_evaluations
      (id,workspace_id,project_id,system_snapshot_id,entry_id,control_profile_version,entry_digest,applicability_status,applicability_reason,contextual_severity,severity_status,evaluator_id,decision_method,evaluated_at,descriptor_json,content_digest)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('cev_'), access.project.workspace_id, access.project.id, snapshotId, row.id, row.knowledge_version,
      row.content_digest, applicability, row.applicability_reason || 'Architecture facts have not been assessed.', semantics.severity, semantics.severityStatus,
      row.assessed_by || userId, row.assessed_at ? 'project_risk_context' : 'snapshot_binding', row.assessed_at || timestamp,canonicalJson(descriptor),intelligenceDigest(descriptor));
  }
}

export async function recordControlTestExecution({ projectId, controlId, userId, input = {} }) {
  const access = await requireAccess(projectId, userId, RECORD_ROLES);
  const snapshot = await requireCurrentSnapshot(access, input.systemSnapshotId);
  const evaluation = await db.prepare(`SELECT * FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?`)
    .get(access.project.workspace_id, projectId, snapshot.id, clean(controlId, 80));
  if (!evaluation) throw notFound('Snapshot-bound control evaluation not found.');
  const check = await db.prepare('SELECT id,entry_id,content_digest,pass_condition,fail_condition FROM risk_knowledge_checks WHERE entry_id=? ORDER BY id LIMIT 1').get(controlId);
  if (!check) throw notFound('Control test definition not found.');
  const result = clean(input.result, 20);
  if (!new Set(['planned','passed','failed','inconclusive']).has(result)) throw badRequest('Test result must be planned, passed, failed or inconclusive.');
  const executionKind=clean(input.executionKind,20)||'initial';
  if (!['initial','retest'].includes(executionKind)) throw badRequest('Execution kind must be initial or retest.');
  let finding = null; let original=null; let remediation=null;
  if (result === 'failed') {
    if(input.findingId){finding = await findingForControl(access,snapshot,controlId,input.findingId);if (!finding) throw conflict('The selected finding is not bound to this control and snapshot.');}
  }
  if (executionKind==='retest') {
    original=await db.prepare("SELECT * FROM control_test_executions WHERE id=? AND workspace_id=? AND project_id=? AND entry_id=? AND result='failed'").get(clean(input.retestOfExecutionId,100),access.project.workspace_id,projectId,controlId);
    if (!original) throw conflict('A retest must reference the original failed execution for this control.');
    finding=await findingForControl(access,{id:original.system_snapshot_id},controlId,input.findingId);
    remediation=await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=? AND finding_key=?').get(clean(input.remediationId,100),projectId,finding?.finding_key||'');
    if (!finding || finding.id!==original.finding_id || !remediation || remediation.id!==finding.id) throw conflict('Retest provenance must identify the original finding and its remediation.');
    if (snapshot.id===original.system_snapshot_id) throw conflict('A retest must execute against a remediated snapshot, not the vulnerable snapshot.');
    const binding=await db.prepare('SELECT id FROM control_finding_bindings WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND finding_id=?').get(access.project.workspace_id,projectId,original.system_snapshot_id,controlId,finding.id);
    const implementation=await db.prepare("SELECT id FROM remediation_evidence_artifacts WHERE workspace_id=? AND project_id=? AND remediation_id=? AND lifecycle_state='active' AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1").get(access.project.workspace_id,projectId,remediation.id);
    if(!binding||!implementation)throw conflict('Retest requires the exact scoped finding binding and active remediation implementation evidence.');
  }
  const timestamp = nowIso();
  const descriptor = { schema: 'arl.control-test-execution.v2', workspaceId:access.project.workspace_id,projectId, systemSnapshotId: snapshot.id,evaluationId:evaluation.id, entryId: controlId, checkId: check.id,
    checkDigest: check.content_digest, executionMethod: clean(input.executionMethod, 80) || 'manual_review', result,
    expectedResult: clean(input.expectedResult, 2000) || check.pass_condition, observedResult: clean(input.observedResult, 2000),
    inputReference: clean(input.inputReference, 500) || null, limitations: clean(input.limitations, 2000), failureReason: clean(input.failureReason, 2000) || null,
    findingId: finding?.id || null,executionKind,retestOfExecutionId:original?.id||null,remediationId:remediation?.id||null,originalSnapshotId:original?.system_snapshot_id||null, executorId: userId, startedAt: safeTime(input.startedAt) || timestamp, completedAt: result === 'planned' ? null : timestamp };
  if (result !== 'planned' && !descriptor.observedResult) throw badRequest('A completed test requires a privacy-safe observed result.');
  rejectSensitive(descriptor);
  const executionId = id('ctx_');
  const contentDigest = intelligenceDigest(descriptor);
  await db.transaction(async()=>{await db.prepare(`INSERT INTO control_test_executions
    (id,workspace_id,project_id,system_snapshot_id,evaluation_id,entry_id,check_id,check_digest,execution_kind,retest_of_execution_id,remediation_id,original_snapshot_id,execution_method,result,expected_result,observed_result,input_reference,limitations,failure_reason,finding_id,executor_id,started_at,completed_at,content_digest,descriptor_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(executionId, access.project.workspace_id, projectId, snapshot.id,evaluation.id, controlId, check.id, check.content_digest,executionKind,original?.id||null,remediation?.id||null,original?.system_snapshot_id||null,
    descriptor.executionMethod, result, descriptor.expectedResult, descriptor.observedResult, descriptor.inputReference, descriptor.limitations, descriptor.failureReason,
    descriptor.findingId, userId, descriptor.startedAt, descriptor.completedAt, contentDigest, canonicalJson(descriptor), timestamp);
  if(finding&&executionKind==='initial'){const bindingDescriptor={schema:'arl.control-finding-binding.v1',workspaceId:access.project.workspace_id,projectId,systemSnapshotId:snapshot.id,entryId:controlId,findingId:finding.id,bindingMethod:'failed_test',boundBy:userId,createdAt:timestamp};const sourceDigest=intelligenceDigest({id:finding.id,projectId:finding.project_id,findingKey:finding.finding_key,title:finding.title,status:finding.status,createdAt:finding.created_at});await db.prepare(`INSERT INTO control_finding_bindings (id,workspace_id,project_id,system_snapshot_id,entry_id,finding_id,source_digest,binding_method,bound_by,descriptor_json,content_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('cfb_'),access.project.workspace_id,projectId,snapshot.id,controlId,finding.id,sourceDigest,'failed_test',userId,canonicalJson(bindingDescriptor),intelligenceDigest(bindingDescriptor),timestamp);}
  await audit(access, userId, 'control_intelligence.test_recorded', 'control_test_execution', executionId, { controlId, result, contentDigest });});
  return { id: executionId, ...descriptor, contentDigest };
}

export async function createControlFinding({projectId,controlId,userId,input={}}){
  let result;
  await db.transaction(async()=>{
    const access=await requireAccess(projectId,userId,RECORD_ROLES,true),snapshot=await requireCurrentSnapshot(access,input.systemSnapshotId);
    const execution=await db.prepare("SELECT * FROM control_test_executions WHERE id=? AND workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND result='failed' AND execution_kind='initial'").get(clean(input.testExecutionId,100),access.project.workspace_id,projectId,snapshot.id,controlId);
    if(!execution)throw conflict('Create a finding from an executed failed test for this control and snapshot.');
    if(execution.finding_id)throw conflict('An active finding already exists for this failed execution.');
    const failureEvidence=await db.prepare("SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND test_execution_id=? AND retention_status='active' AND verification_state IN ('unverified','verified') ORDER BY observed_at DESC LIMIT 1").get(access.project.workspace_id,projectId,snapshot.id,controlId,execution.id);
    if(!failureEvidence)throw conflict('Attach active observed evidence to the failed test before creating a finding.');
    await verifyRows([failureEvidence],'integrity_digest','evidence');
    const title=clean(input.title,240),narrative=clean(input.narrative,2000),impact=clean(input.impact,2000);if(title.length<3||narrative.length<10||impact.length<5)throw badRequest('Finding title, what happened and impact are required.');
    const {impactFacts:rawImpactFacts,...customerFields}=input;rejectSensitive(customerFields);const allowedImpactFacts=['crossTenantAccess','secretExposure','financialAction','administrativeAction','irreversibleSideEffect','approvalBypass','availabilityImpact'];const suppliedFlags=rawImpactFacts&&typeof rawImpactFacts==='object'?rawImpactFacts:{};const flags=Object.fromEntries(allowedImpactFacts.filter(key=>suppliedFlags[key]===true).map(key=>[key,true]));const severe=['crossTenantAccess','secretExposure','financialAction','administrativeAction','irreversibleSideEffect','approvalBypass'].filter(key=>flags[key]);const severity=severe.length>=2?'critical':severe.length===1?'high':flags.availabilityImpact?'medium':'low';
    const findingId=id('rem_'),timestamp=nowIso(),findingKey=`${controlId}-${execution.id}`;const verification={schema:'arl.control-finding.v1',failedExecutionId:execution.id,expectedResult:execution.expected_result,observedResult:execution.observed_result,narrative,affectedAsset:clean(input.affectedAsset,500),impact,sideEffectOutcome:clean(input.sideEffectOutcome,50),reproductionSummary:clean(input.reproductionSummary,1000),containment:clean(input.containment,1000),limitations:clean(input.limitations,1000),impactFacts:Object.keys(flags),creatorId:userId,createdAt:timestamp};verification.integrityDigest=intelligenceDigest(verification);
    await db.prepare(`INSERT INTO remediation_items (id,project_id,finding_key,title,severity,status,owner_email,due_at,verification_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?,?,?,?)`).run(findingId,projectId,findingKey,title,severity,clean(input.ownerEmail,254)||null,safeTime(input.dueAt),JSON.stringify(verification),userId,timestamp,timestamp);
    const bindingDescriptor={schema:'arl.control-finding-binding.v1',workspaceId:access.project.workspace_id,projectId,systemSnapshotId:snapshot.id,entryId:controlId,findingId,bindingMethod:'failed_test',confirmationMethod:'customer_confirmed',boundBy:userId,createdAt:timestamp};const sourceDigest=intelligenceDigest({id:findingId,projectId,findingKey,title,status:'open',createdAt:timestamp});
    await db.prepare(`INSERT INTO control_finding_bindings (id,workspace_id,project_id,system_snapshot_id,entry_id,finding_id,source_digest,binding_method,bound_by,descriptor_json,content_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('cfb_'),access.project.workspace_id,projectId,snapshot.id,controlId,findingId,sourceDigest,'failed_test',userId,canonicalJson(bindingDescriptor),intelligenceDigest(bindingDescriptor),timestamp);
    const descriptor={...parseJson(execution.descriptor_json,{}),findingId};await db.prepare('UPDATE control_test_executions SET finding_id=?,descriptor_json=?,content_digest=? WHERE id=?').run(findingId,canonicalJson(descriptor),intelligenceDigest(descriptor),execution.id);
    await audit(access,userId,'control_intelligence.finding_created','remediation',findingId,{controlId,testExecutionId:execution.id,severityStatus:'evaluated',contextualSeverity:severity});result={id:findingId,title,status:'open',contextualSeverity:severity,severityStatus:'evaluated',failedTestExecutionId:execution.id,snapshotId:snapshot.id,controlId,owner:clean(input.ownerEmail,254)||null,createdAt:timestamp};
  });return result;
}

export async function recordControlEvidence({ projectId, controlId, userId, input = {} }) {
  const access = await requireAccess(projectId, userId, RECORD_ROLES);
  const snapshot = await requireCurrentSnapshot(access, input.systemSnapshotId);
  const evidenceClass = clean(input.evidenceClass, 30);
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw badRequest('Unsupported evidence class.');
  const sourceType = clean(input.sourceType, 40);
  const sourceReference = clean(input.sourceReference, 300);
  if (!sourceType || !sourceReference) throw badRequest('Evidence source type and privacy-safe reference are required.');
  let execution = null; let runtime = null; let approval = null; let artifact = null; let finding = null; let remediation=null;
  if (input.testExecutionId) execution = await db.prepare('SELECT id,entry_id FROM control_test_executions WHERE id=? AND workspace_id=? AND project_id=? AND system_snapshot_id=?').get(clean(input.testExecutionId, 100), access.project.workspace_id, projectId, snapshot.id);
  if (input.runtimeEventId) runtime = await db.prepare(`SELECT r.id,r.content_digest,r.policy_digest,r.created_at FROM runtime_events r
    JOIN control_snapshot_runtime_bindings b ON b.runtime_event_id=r.id AND b.workspace_id=? AND b.project_id=r.project_id AND b.system_snapshot_id=? AND b.entry_id=?
    WHERE r.id=? AND r.project_id=?`).get(access.project.workspace_id, snapshot.id,controlId, clean(input.runtimeEventId, 100), projectId);
  if (input.approvalId) approval = await db.prepare(`SELECT a.id,a.action_digest,a.issued_at FROM runtime_approvals a
    JOIN control_snapshot_runtime_bindings b ON b.approval_id=a.id AND b.workspace_id=a.workspace_id AND b.project_id=a.project_id AND b.system_snapshot_id=? AND b.entry_id=?
    WHERE a.id=? AND a.workspace_id=? AND a.project_id=?`).get(snapshot.id,controlId, clean(input.approvalId, 100), access.project.workspace_id, projectId);
  if (input.remediationArtifactId) artifact = await db.prepare('SELECT id,remediation_id,content_digest,created_at FROM remediation_evidence_artifacts WHERE id=? AND workspace_id=? AND project_id=?').get(clean(input.remediationArtifactId, 100), access.project.workspace_id, projectId);
  if (input.findingId) finding = await findingForControl(access,snapshot,controlId,input.findingId);
  if (input.remediationId) remediation=await findingForControl(access,snapshot,controlId,input.remediationId,true);
  if (input.testExecutionId && (!execution || execution.entry_id !== controlId)) throw notFound('Test execution not found for this control and snapshot.');
  if (input.runtimeEventId && !runtime) throw notFound('Runtime evidence source is not bound to this project snapshot.');
  if (input.approvalId && !approval) throw notFound('Approval source is not bound to this project snapshot.');
  if (input.remediationArtifactId && !artifact) throw notFound('Remediation evidence source not found in this project.');
  if (input.findingId && !finding) throw notFound('Finding source not found in this project.');
  if (input.remediationId && (!remediation || remediation.id!==finding?.id)) throw notFound('Remediation source does not match this finding and control.');
  if (artifact && (!remediation || artifact.remediation_id!==remediation.id)) throw notFound('Remediation artifact does not match this control remediation.');
  if (evidenceClass === 'runtime' && !runtime) throw badRequest('Runtime evidence requires a project runtime event.');
  const verificationState = evidenceClass === 'declared' ? 'declared' : (runtime || approval || artifact) ? 'verified' : 'unverified';
  const timestamp = nowIso();
  const descriptor = { schema: 'arl.control-evidence.v2',workspaceId:access.project.workspace_id, projectId, systemSnapshotId: snapshot.id, controlId, evidenceClass, sourceType, sourceReference,
    testExecutionId: execution?.id || null, runtimeEventId: runtime?.id || null, approvalId: approval?.id || null, remediationArtifactId: artifact?.id || null,
    findingId: finding?.id || null,remediationId:remediation?.id||null, observedAt: safeTime(input.observedAt) || runtime?.created_at || artifact?.created_at || timestamp,collectorId:userId,
    sourceDigest: runtime?.content_digest || runtime?.policy_digest || approval?.action_digest || artifact?.content_digest || null,
    sensitivityClassification: SENSITIVITY.has(input.sensitivityClassification) ? input.sensitivityClassification : 'internal',retentionStatus:'active', verificationState,
    limitations: clean(input.limitations, 2000) };
  rejectSensitive(descriptor);
  const evidenceId = id('cei_');
  const integrityDigest = intelligenceDigest(descriptor);
  await db.prepare(`INSERT INTO control_evidence_items
    (id,workspace_id,project_id,system_snapshot_id,entry_id,test_execution_id,finding_id,evidence_class,source_type,source_reference,runtime_event_id,approval_id,remediation_artifact_id,remediation_id,observed_at,collector_id,integrity_digest,descriptor_json,sensitivity_classification,retention_status,verification_state,limitations,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evidenceId, access.project.workspace_id, projectId, snapshot.id, controlId, execution?.id || null,
    finding?.id || null, evidenceClass, sourceType, sourceReference, runtime?.id || null, approval?.id || null, artifact?.id || null,remediation?.id||null, descriptor.observedAt, userId,
    integrityDigest, canonicalJson(descriptor), descriptor.sensitivityClassification,'active', verificationState, descriptor.limitations, timestamp);
  await audit(access, userId, 'control_intelligence.evidence_recorded', 'control_evidence', evidenceId, { controlId, evidenceClass, verificationState, integrityDigest });
  return { id: evidenceId, ...descriptor, integrityDigest, retentionStatus: 'active' };
}

export async function recordDeploymentDecision({ projectId, userId, input = {} }) {
  let output;
  await db.transaction(async () => {
    const access = await requireAccess(projectId, userId, DECISION_ROLES,true);
    const snapshot = await requireCurrentSnapshot(access, input.systemSnapshotId);
    const current=await db.prepare("SELECT * FROM control_deployment_decisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND status='current'").get(access.project.workspace_id,projectId,snapshot.id);
    if (input.expectedCurrentDecisionId != null && clean(input.expectedCurrentDecisionId,100)!==(current?.id||'')) throw conflict('The deployment decision changed after this page was loaded. Reload before recording another decision.');
    const derived = await deriveDeploymentDecision(access, snapshot);
    const timestamp = nowIso(); const rationale = clean(input.rationale, 3000) || derived.rationale; const decisionId=id('cdd_');
    const descriptor = { schema: 'arl.control-intelligence-decision.v2',workspaceId:access.project.workspace_id, projectId, systemSnapshotId: snapshot.id,
      systemSnapshotDigest: snapshot.content_digest, controlProfileVersion: 'ARL-RKA-1.2.0',controlProfileDigest:derived.controlProfileDigest, decision: derived.decision,
      summary: derived.summary,reasons:derived.reasons, evidenceIds:derived.evidenceIds,requiredApprovals:derived.requiredApprovals, rationale, decisionMethod: 'server_derived_human_recorded', decisionMakerId: userId, decidedAt: timestamp,
      expiresAt: safeTime(input.expiresAt) || null,supersedesDecisionId:current?.id||null,reassessmentTrigger:null };
    const decisionDigest=intelligenceDigest(descriptor);
    if(current) await db.prepare("UPDATE control_deployment_decisions SET status='stale',reassessment_trigger='superseded_by_new_decision' WHERE id=? AND status='current'").run(current.id);
    await db.prepare(`INSERT INTO control_deployment_decisions
      (id,workspace_id,project_id,system_snapshot_id,control_profile_version,decision,status,rationale,summary_json,decision_method,decision_maker_id,decision_digest,decided_at,expires_at,supersedes_decision_id,descriptor_json)
      VALUES (?,?,?,?,?,?, 'current',?,?,?,?,?,?,?,?,?)`).run(decisionId, access.project.workspace_id, projectId, snapshot.id, descriptor.controlProfileVersion,
      derived.decision, rationale, canonicalJson(derived.summary), descriptor.decisionMethod, userId, decisionDigest, timestamp, descriptor.expiresAt,current?.id||null,canonicalJson(descriptor));
    for (const evidenceId of derived.evidenceIds) await db.prepare("INSERT INTO deployment_decision_evidence (decision_id,evidence_id,workspace_id,project_id,system_snapshot_id,relationship) VALUES (?,?,?,?,?,'context')").run(decisionId,evidenceId,access.project.workspace_id,projectId,snapshot.id);
    await audit(access, userId, 'control_intelligence.deployment_decision_recorded', 'deployment_decision', decisionId, { decision: derived.decision, decisionDigest });
    output={ id: decisionId, ...descriptor, decisionDigest, status: 'current' };
  });
  return output;
}

export async function closeControlFinding({projectId,controlId,findingId,userId,input={}}){
  let result;
  await db.transaction(async()=>{
    const access=await requireAccess(projectId,userId,DECISION_ROLES,true);
    const snapshot=await requireCurrentSnapshot(access,input.systemSnapshotId);
    const finding=await db.prepare(`SELECT r.*,b.entry_id,b.system_snapshot_id original_snapshot_id FROM remediation_items r
      JOIN control_finding_bindings b ON b.finding_id=r.id AND b.workspace_id=? AND b.project_id=? AND b.entry_id=?
      WHERE r.id=? AND r.project_id=?`).get(access.project.workspace_id,projectId,controlId,clean(findingId,100),projectId);
    if(!finding)throw notFound('Finding is not bound to this control.');
    if(input.expectedUpdatedAt&&input.expectedUpdatedAt!==finding.updated_at)throw conflict('The finding changed after this page was loaded. Reload before reviewing closure.');
    const retest=await db.prepare(`SELECT * FROM control_test_executions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND finding_id=? AND execution_kind='retest' AND result='passed' ORDER BY completed_at DESC LIMIT 1`).get(access.project.workspace_id,projectId,snapshot.id,controlId,finding.id);
    if(!retest||!retest.retest_of_execution_id||!retest.remediation_id||retest.original_snapshot_id===snapshot.id)throw conflict('Finding closure requires a passed exact retest against the remediated snapshot.');
    await verifyRows([retest],'content_digest','test');
    const evidence=await db.prepare(`SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND test_execution_id=? AND finding_id=? AND remediation_id=? AND verification_state='verified' AND retention_status='active' ORDER BY observed_at DESC LIMIT 1`).get(access.project.workspace_id,projectId,snapshot.id,controlId,retest.id,finding.id,finding.id);
    if(!evidence)throw conflict('Finding closure requires verified evidence for the exact retest.');
    await verifyRows([evidence],'integrity_digest','evidence');
    const artifact=await db.prepare("SELECT id FROM remediation_evidence_artifacts WHERE workspace_id=? AND project_id=? AND remediation_id=? AND artifact_type='implementation' AND lifecycle_state='active' AND invalidated_at IS NULL LIMIT 1").get(access.project.workspace_id,projectId,finding.id);
    if(!artifact)throw conflict('Finding closure requires active remediation implementation evidence.');
    const timestamp=nowIso();const verification={...parseJson(finding.verification_json,{}),controlIntelligenceClosure:{reviewerId:userId,reviewerRole:access.role,retestId:retest.id,evidenceId:evidence.id,remediatedSnapshotId:snapshot.id,reviewedAt:timestamp,limitations:clean(input.limitations,1000)}};
    verification.controlIntelligenceClosure.digest=intelligenceDigest(verification.controlIntelligenceClosure);
    await db.prepare("UPDATE remediation_items SET status='verified_closed',verification_json=?,updated_at=? WHERE id=? AND project_id=?").run(JSON.stringify(verification),timestamp,finding.id,projectId);
    await audit(access,userId,'control_intelligence.finding_closed','remediation',finding.id,{controlId,retestId:retest.id,evidenceId:evidence.id,snapshotId:snapshot.id});
    result={id:finding.id,status:'verified_closed',reviewedAt:timestamp,closureDigest:verification.controlIntelligenceClosure.digest};
  });return result;
}

async function deriveDeploymentDecision(access, snapshot) {
  const evaluations = await db.prepare('SELECT * FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=?').all(access.project.workspace_id, access.project.id, snapshot.id);
  await verifyRows(evaluations,'content_digest','evaluation');
  await verifySnapshot(snapshot);
  const tests = await db.prepare('SELECT * FROM control_test_executions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=?').all(access.project.workspace_id, access.project.id, snapshot.id);
  const evidence = await db.prepare("SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=?").all(access.project.workspace_id, access.project.id, snapshot.id);
  await verifyRows(tests,'content_digest','test'); await verifyRows(evidence,'integrity_digest','evidence');
  const findings = await db.prepare(`SELECT r.id,r.finding_key,r.status,c.entry_id,c.contextual_severity,c.severity_status
    FROM remediation_items r JOIN control_finding_bindings b ON b.finding_id=r.id AND b.workspace_id=? AND b.project_id=r.project_id AND b.system_snapshot_id=?
    JOIN control_snapshot_evaluations c ON c.workspace_id=b.workspace_id AND c.project_id=b.project_id AND c.system_snapshot_id=b.system_snapshot_id AND c.entry_id=b.entry_id
    WHERE r.project_id=? AND r.status NOT IN ('verified_closed','accepted_risk')`).all(access.project.workspace_id,snapshot.id,access.project.id);
  const unboundFindings=Number((await db.prepare(`SELECT COUNT(*) count FROM remediation_items r WHERE r.project_id=? AND r.status NOT IN ('verified_closed','accepted_risk') AND NOT EXISTS (SELECT 1 FROM control_finding_bindings b WHERE b.finding_id=r.id AND b.workspace_id=? AND b.project_id=? AND b.system_snapshot_id=?)`).get(access.project.id,access.project.workspace_id,access.project.id,snapshot.id)).count||0);
  const applicable = evaluations.filter((row) => row.applicability_status === 'applicable');
  const unknown = evaluations.filter((row) => row.applicability_status === 'unknown');
  const tested = new Set(tests.filter((row) => row.result === 'passed' && (row.execution_kind==='initial'||validRetest(row,tests,findings))).map((row) => row.entry_id));
  const observed = new Set(evidence.filter((row) => ['verified'].includes(row.verification_state) && row.retention_status === 'active').map((row) => row.entry_id));
  const missingEvidence = applicable.filter((row) => !tested.has(row.entry_id) || !observed.has(row.entry_id)).length;
  const criticalBlockers = findings.filter((row) => row.contextual_severity === 'critical' && row.severity_status === 'evaluated').length;
  const requiredApprovals=requiredApprovalControls(snapshot,applicable);
  const approvals=await db.prepare(`SELECT b.entry_id,b.descriptor_json binding_descriptor,b.content_digest binding_digest,b.approval_requirement_id,a.*,q.descriptor_json requirement_descriptor,q.requirement_digest,q.action_digest requirement_action_digest,q.reuse_scope FROM control_snapshot_runtime_bindings b JOIN runtime_approvals a ON a.id=b.approval_id JOIN control_approval_requirements q ON q.id=b.approval_requirement_id AND q.workspace_id=b.workspace_id AND q.project_id=b.project_id AND q.system_snapshot_id=b.system_snapshot_id AND q.entry_id=b.entry_id WHERE b.workspace_id=? AND b.project_id=? AND b.system_snapshot_id=? AND b.binding_type='exact_action_approval'`).all(access.project.workspace_id,access.project.id,snapshot.id);
  const validApprovals=new Set(approvals.filter(validApproval).map(x=>x.entry_id));
  const missingApprovals=requiredApprovals.filter(x=>!validApprovals.has(x));
  const summary = { applicableControls: applicable.length, controlsNeedingAssessment: unknown.length,
    controlsWithObservedEvidence: observed.size, controlsMissingEvidence: missingEvidence, openFindings: findings.length,
    criticalBlockers, failedTests: tests.filter((row) => row.result === 'failed').length,
    completedRetests: tests.filter((row) => validRetest(row,tests,findings)).length,requiredApprovals:requiredApprovals.length,missingRequiredApprovals:missingApprovals.length,unboundHistoricalFindings:unboundFindings };
  const reasons=[]; if(unknown.length)reasons.push('material_context_missing'); if(missingEvidence)reasons.push('required_evidence_missing'); if(findings.length)reasons.push('open_findings'); if(unboundFindings)reasons.push('legacy_evidence_exact_scope_unproven'); if(missingApprovals.length)reasons.push('approval_exact_scope_unproven');
  const common={summary,reasons,evidenceIds:evidence.filter(x=>x.verification_state==='verified'&&x.retention_status==='active').map(x=>x.id).sort(),requiredApprovals,controlProfileDigest:intelligenceDigest(evaluations.map(x=>({id:x.entry_id,digest:x.entry_digest})).sort((a,b)=>a.id.localeCompare(b.id)))};
  if (criticalBlockers) return { ...common,decision: 'do_not_deploy', rationale: 'An open evaluated Critical finding blocks deployment.' };
  if (reasons.length || tests.some((row) => row.result === 'failed' && !tests.some(r=>r.execution_kind==='retest'&&r.result==='passed'&&r.retest_of_execution_id===row.id))) return { ...common,decision: 'hold', rationale: 'Material context, evidence, findings, retesting or approvals remain unresolved.' };
  return { ...common,decision: 'proceed', rationale: 'Applicable controls have current verified evidence, valid required approvals and no open blockers; human review remains required.' };
}

export async function getControlIntelligence({ projectId, userId, limit = 25, offset = 0, status = '' }) {
  const access = await requireAccess(projectId, userId, VIEW_ROLES);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const snapshot = await db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current' ORDER BY created_at DESC LIMIT 1").get(access.project.workspace_id, projectId);
  if (!snapshot) return emptyGraph(access, safeLimit, safeOffset);
  await verifySnapshot(snapshot);
  const allEvaluations = await db.prepare('SELECT * FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY entry_id').all(access.project.workspace_id, projectId, snapshot.id);
  await verifyRows(allEvaluations,'content_digest','evaluation');
  const derived = await loadDerivedRows(access, snapshot, allEvaluations);
  derived.snapshotAssessmentConfiguration=snapshot.assessment_configuration_json;
  derived.suggestions=suggestControls(derived.entries,snapshotFacts(snapshot),snapshot.id);
  const chains = deriveChains(allEvaluations, derived);
  const filtered = status ? chains.filter((chain) => chain.chainStatus === status) : chains;
  const page = filtered.slice(safeOffset, safeOffset + safeLimit);
  const graph = buildGraph(access, snapshot, page, derived);
  const latestDecision = derived.decisions[0] || null;
  if(latestDecision) await verifyRows([latestDecision],'decision_digest','decision');
  return { graphVersion: '1.0', project: { id: projectId, name: access.project.name, role: access.role }, systemSnapshot: serializeSnapshot(snapshot),
    controlProfileVersion: 'ARL-RKA-1.2.0', suggestionProfile:suggestionProfile(), summary: summarizeChains(chains, derived), deploymentState: latestDecision ? serializeDecision(latestDecision) : null,
    items: page, total: filtered.length, limit: safeLimit, offset: safeOffset, hasMore: safeOffset + page.length < filtered.length,
    filters: { chainStatus: countValues(chains.map((chain) => chain.chainStatus)) }, nodes: graph.nodes, edges: graph.edges };
}

export async function getControlIntelligenceControl({ projectId, controlId, userId, historyLimit = 25 }) {
  const access = await requireAccess(projectId, userId, VIEW_ROLES);
  const snapshot = await db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current' ORDER BY created_at DESC LIMIT 1").get(access.project.workspace_id, projectId);
  if (!snapshot) throw notFound('Create a system snapshot before opening control intelligence detail.');
  await verifySnapshot(snapshot);
  const evaluation = await db.prepare(`SELECT c.*,e.title,e.category,e.problem_json,e.content_digest knowledge_digest,k.objective,k.method,k.required_evidence_json,k.pass_condition,k.fail_condition,k.limitations,k.content_digest check_digest,k.id check_id,
      COALESCE(v.lifecycle_status,'candidate') lifecycle_status,
      (SELECT default_owner FROM risk_knowledge_solutions s WHERE s.entry_id=e.id ORDER BY s.priority,s.id LIMIT 1) accountable_owner
    FROM control_snapshot_evaluations c JOIN risk_knowledge_entries e ON e.id=c.entry_id LEFT JOIN risk_knowledge_checks k ON k.entry_id=e.id
    LEFT JOIN risk_knowledge_validation_records v ON v.entry_id=e.id AND v.knowledge_version=e.knowledge_version
    WHERE c.workspace_id=? AND c.project_id=? AND c.system_snapshot_id=? AND c.entry_id=? ORDER BY k.id LIMIT 1`).get(access.project.workspace_id, projectId, snapshot.id, clean(controlId, 80));
  if (!evaluation) throw notFound('Control evaluation not found for the current snapshot.');
  await verifyRows([evaluation],'content_digest','evaluation');
  const limit = Math.max(1, Math.min(50, Number(historyLimit) || 25));
  const [tests,evidence,links,remediations,runtime,approvals,decisions,mappings,revisions,requirements,testHistory] = await Promise.all([
    db.prepare('SELECT * FROM control_test_executions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? ORDER BY created_at DESC LIMIT ?').all(access.project.workspace_id, projectId, snapshot.id, controlId, limit),
    db.prepare('SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? ORDER BY observed_at DESC LIMIT ?').all(access.project.workspace_id, projectId, snapshot.id, controlId, limit),
    db.prepare('SELECT subject_type,subject_id,link_role,knowledge_version,entry_digest,created_at FROM risk_knowledge_links WHERE workspace_id=? AND project_id=? AND entry_id=? ORDER BY created_at DESC LIMIT ?').all(access.project.workspace_id, projectId, controlId, limit),
    db.prepare("SELECT * FROM remediation_items WHERE project_id=? AND (finding_key=? OR finding_key LIKE ?) ORDER BY updated_at DESC LIMIT ?").all(projectId, controlId, `${controlId}%`, limit),
    db.prepare(`SELECT r.id,r.decision,r.observed_decision,r.severity,r.rule_ids_json,r.tool_name,r.argument_digest,r.policy_version,r.policy_digest,r.retest_criteria_id,r.remediation_id,r.retest_satisfied,r.created_at
      FROM runtime_events r JOIN control_snapshot_runtime_bindings b ON b.runtime_event_id=r.id AND b.system_snapshot_id=?
      JOIN risk_knowledge_links l ON l.subject_type='runtime_event' AND l.subject_id=r.id AND l.project_id=r.project_id WHERE r.project_id=? AND l.entry_id=? ORDER BY r.created_at DESC LIMIT ?`).all(snapshot.id, projectId, controlId, limit),
    db.prepare(`SELECT b.entry_id,b.workspace_id,b.project_id,b.approval_requirement_id,b.descriptor_json binding_descriptor,b.content_digest binding_digest,a.id,a.tool_name,a.environment,a.action_digest,a.status,a.issued_at,a.expires_at,a.consumed_at,a.revoked_at,a.runtime_event_id,q.descriptor_json requirement_descriptor,q.requirement_digest,q.action_digest requirement_action_digest,q.reuse_scope
      FROM runtime_approvals a JOIN control_snapshot_runtime_bindings b ON b.approval_id=a.id AND b.workspace_id=? AND b.project_id=? AND b.system_snapshot_id=? AND b.entry_id=? JOIN control_approval_requirements q ON q.id=b.approval_requirement_id
      WHERE a.workspace_id=b.workspace_id AND a.project_id=b.project_id ORDER BY a.issued_at DESC LIMIT ?`).all(access.project.workspace_id,projectId,snapshot.id,controlId,limit),
    db.prepare('SELECT * FROM control_deployment_decisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY decided_at DESC LIMIT ?').all(access.project.workspace_id, projectId, snapshot.id, limit),
    db.prepare('SELECT framework,framework_version,framework_reference,mapping_status,mapping_limit FROM risk_knowledge_mappings WHERE entry_id=? ORDER BY framework,framework_reference').all(controlId),
    db.prepare('SELECT id,decision,reason,architecture_facts_json,evaluator_id,evaluator_role,evaluated_at,evaluation_digest,previous_revision_id FROM control_applicability_revisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? ORDER BY evaluated_at DESC,id DESC LIMIT ?').all(access.project.workspace_id,projectId,snapshot.id,controlId,limit),
    db.prepare('SELECT id,action_type,reuse_scope,descriptor_json,requirement_digest,created_at FROM control_approval_requirements WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? ORDER BY created_at DESC LIMIT ?').all(access.project.workspace_id,projectId,snapshot.id,controlId,limit),
    db.prepare('SELECT * FROM control_test_executions WHERE workspace_id=? AND project_id=? AND entry_id=? ORDER BY created_at DESC LIMIT ?').all(access.project.workspace_id,projectId,controlId,limit),
  ]);
  await verifyRows(tests, 'content_digest','test');
  await verifyRows(evidence, 'integrity_digest','evidence');
  await verifyRows(decisions,'decision_digest','decision');
  const bindings=await db.prepare('SELECT * FROM control_snapshot_runtime_bindings WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY created_at DESC LIMIT 500').all(access.project.workspace_id,access.project.id,snapshot.id);
  await verifyRows(bindings,'content_digest','binding');
  const [previousControl,nextControl]=await Promise.all([
    db.prepare('SELECT entry_id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id<? ORDER BY entry_id DESC LIMIT 1').get(access.project.workspace_id,projectId,snapshot.id,controlId),
    db.prepare('SELECT entry_id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id>? ORDER BY entry_id LIMIT 1').get(access.project.workspace_id,projectId,snapshot.id,controlId),
  ]);
  const derived = { tests:testHistory, evidence, links, remediations, runtime, approvals, requirements:requirements.map(row=>({entry_id:controlId,...row})), decisions };
  const chain = deriveChains([evaluation], derived)[0];
  return { graphVersion: '1.0', project: { id: projectId, name: access.project.name, role: access.role }, systemSnapshot: serializeSnapshot(snapshot),
    control: { id: evaluation.entry_id, title: evaluation.title, category: evaluation.category, problem: parseJson(evaluation.problem_json, {}),
      version: evaluation.control_profile_version, digest: evaluation.entry_digest, lifecycleStatus: evaluation.lifecycle_status, accountableOwner: evaluation.accountable_owner },
    applicability: { status: revisions[0]?.decision||(evaluation.applicability_status==='unknown'?'context_required':evaluation.applicability_status), reason: evaluation.applicability_reason, architectureFactIds:parseJson(revisions[0]?.architecture_facts_json,[]), evaluatorId:revisions[0]?.evaluator_id||evaluation.evaluator_id, evaluatorRole:revisions[0]?.evaluator_role||null, evaluatedAt:revisions[0]?.evaluated_at||evaluation.evaluated_at, evaluationDigest:revisions[0]?.evaluation_digest||evaluation.content_digest, history:revisions.map(row=>({...row,architectureFactIds:parseJson(row.architecture_facts_json,[])})) },
    severity: { value: evaluation.contextual_severity, status: evaluation.severity_status, scope: 'project', model: 'project_contextual' },
    testDefinition: { id: evaluation.check_id, digest: evaluation.check_digest, objective: evaluation.objective, method: evaluation.method,
      requiredEvidence: parseJson(evaluation.required_evidence_json, []), passCondition: evaluation.pass_condition, failCondition: evaluation.fail_condition, limitations: evaluation.limitations },
    threatScenarios: threatScenarios(evaluation), tests: tests.map(serializeTest), testHistory:testHistory.map(serializeTest), evidence: evidence.map(serializeEvidence),
    findings: remediations.map((row) => serializeFinding(row, evaluation)), runtimeDecisions: runtime.map(serializeRuntime), approvals: approvals.map(serializeApproval),
    remediation: remediations.map((row) => serializeFinding(row, evaluation)), retests: runtime.filter((row) => row.retest_criteria_id).map(serializeRuntime),
    deploymentDecisions: decisions.map(serializeDecision), approvalRequirements:requirements.map(row=>({id:row.id,actionType:row.action_type,reuseScope:row.reuse_scope,requirementDigest:row.requirement_digest,details:parseJson(row.descriptor_json,{})})), frameworkMappings: mappings, chain, architectureFacts:snapshotFacts(snapshot), suggestion:suggestControls([{id:evaluation.entry_id,title:evaluation.title,category:evaluation.category,problem_json:evaluation.problem_json,content_digest:evaluation.entry_digest}],snapshotFacts(snapshot),snapshot.id)[0],suggestionProfile:suggestionProfile(),navigation:{previousControlId:previousControl?.entry_id||null,nextControlId:nextControl?.entry_id||null} };
}

async function loadDerivedRows(access, snapshot, evaluations) {
  const entryIds = evaluations.map((row) => row.entry_id);
  if (!entryIds.length) return { entries: [], checks: [], tests: [], evidence: [], links: [], remediations: [], runtime: [], approvals: [], requirements:[], decisions: [], decisionEvidence: [] };
  const marks = entryIds.map(() => '?').join(',');
  const [entries,checks,tests,evidence,links,remediations,runtime,approvals,requirements,decisions,decisionEvidence,revisions] = await Promise.all([
    db.prepare(`SELECT e.id,e.title,e.category,e.problem_json,e.knowledge_version,e.content_digest,COALESCE(v.lifecycle_status,'candidate') lifecycle_status,
      (SELECT default_owner FROM risk_knowledge_solutions s WHERE s.entry_id=e.id ORDER BY s.priority,s.id LIMIT 1) accountable_owner
      FROM risk_knowledge_entries e LEFT JOIN risk_knowledge_validation_records v ON v.entry_id=e.id AND v.knowledge_version=e.knowledge_version
      WHERE e.id IN (${marks}) ORDER BY e.id`).all(...entryIds),
    db.prepare(`SELECT id,entry_id,content_digest FROM risk_knowledge_checks WHERE entry_id IN (${marks}) ORDER BY entry_id,id`).all(...entryIds),
    db.prepare('SELECT * FROM control_test_executions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY created_at DESC LIMIT 500').all(access.project.workspace_id, access.project.id, snapshot.id),
    db.prepare('SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY observed_at DESC LIMIT 500').all(access.project.workspace_id, access.project.id, snapshot.id),
    db.prepare(`SELECT * FROM risk_knowledge_links WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC LIMIT 500`).all(access.project.workspace_id, access.project.id),
    db.prepare('SELECT * FROM remediation_items WHERE project_id=? ORDER BY updated_at DESC LIMIT 250').all(access.project.id),
    db.prepare(`SELECT r.id,r.decision,r.observed_decision,r.severity,r.rule_ids_json,r.tool_name,r.argument_digest,r.policy_version,r.policy_digest,r.retest_criteria_id,r.remediation_id,r.retest_satisfied,r.created_at
      FROM runtime_events r JOIN control_snapshot_runtime_bindings b ON b.runtime_event_id=r.id AND b.system_snapshot_id=? WHERE r.project_id=? ORDER BY r.created_at DESC LIMIT 250`).all(snapshot.id, access.project.id),
    db.prepare(`SELECT b.entry_id,b.workspace_id,b.project_id,b.approval_requirement_id,b.descriptor_json binding_descriptor,b.content_digest binding_digest,a.id,a.tool_name,a.environment,a.action_digest,a.status,a.issued_at,a.expires_at,a.consumed_at,a.revoked_at,a.runtime_event_id,q.descriptor_json requirement_descriptor,q.requirement_digest,q.action_digest requirement_action_digest,q.reuse_scope
      FROM runtime_approvals a JOIN control_snapshot_runtime_bindings b ON b.approval_id=a.id AND b.system_snapshot_id=? JOIN control_approval_requirements q ON q.id=b.approval_requirement_id WHERE a.workspace_id=? AND a.project_id=? ORDER BY a.issued_at DESC LIMIT 250`).all(snapshot.id, access.project.workspace_id, access.project.id),
    db.prepare('SELECT entry_id,requirement_digest FROM control_approval_requirements WHERE workspace_id=? AND project_id=? AND system_snapshot_id=?').all(access.project.workspace_id,access.project.id,snapshot.id),
    db.prepare('SELECT * FROM control_deployment_decisions WHERE workspace_id=? AND project_id=? ORDER BY decided_at DESC LIMIT 25').all(access.project.workspace_id, access.project.id),
    db.prepare(`SELECT de.decision_id,de.evidence_id,de.relationship FROM deployment_decision_evidence de
      JOIN control_deployment_decisions d ON d.id=de.decision_id WHERE d.workspace_id=? AND d.project_id=? AND d.system_snapshot_id=? LIMIT 500`).all(access.project.workspace_id,access.project.id,snapshot.id),
    db.prepare('SELECT entry_id,evaluation_digest,evaluated_at FROM control_applicability_revisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY evaluated_at DESC,id DESC LIMIT 500').all(access.project.workspace_id,access.project.id,snapshot.id),
  ]);
  await verifyRows(tests, 'content_digest','test');
  await verifyRows(evidence, 'integrity_digest','evidence');
  await verifyRows(decisions,'decision_digest','decision');
  return { entries,checks,tests,evidence,links,remediations,runtime,approvals,requirements,decisions,decisionEvidence,revisions };
}

export async function prepareControlIntelligenceSourcePurge({ projectId, runtimeEventIds = [], approvalIds = [], timestamp = nowIso() }) {
  const runtimeIds = runtimeEventIds.filter(Boolean);
  const approvals = approvalIds.filter(Boolean);
  await db.transaction(async () => {
    for (const sourceId of runtimeIds) await db.prepare("UPDATE control_evidence_items SET verification_state='stale',retention_status='deleted_source' WHERE project_id=? AND runtime_event_id=?").run(projectId, sourceId);
    for (const sourceId of approvals) await db.prepare("UPDATE control_evidence_items SET verification_state='stale',retention_status='deleted_source' WHERE project_id=? AND approval_id=?").run(projectId, sourceId);
    if (runtimeIds.length || approvals.length) await db.prepare("UPDATE control_deployment_decisions SET status='stale',reassessment_trigger='evidence_source_retention' WHERE project_id=? AND status='current'").run(projectId);
  });
  return { runtimeEvents: runtimeIds.length, approvals: approvals.length, timestamp };
}

export async function getControlIntelligenceReportSummary({projectId}){
  const project=await db.prepare('SELECT id,workspace_id,name FROM security_projects WHERE id=?').get(clean(projectId,100));if(!project)return null;
  const snapshot=await db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current'").get(project.workspace_id,project.id);if(!snapshot)return null;await verifySnapshot(snapshot);
  const evaluations=await db.prepare('SELECT * FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY entry_id').all(project.workspace_id,project.id,snapshot.id);await verifyRows(evaluations,'content_digest','evaluation');
  const suggestionEntries=await db.prepare('SELECT id,title,category,problem_json,content_digest FROM risk_knowledge_entries WHERE status=\'active\' ORDER BY id').all();const suggestions=suggestControls(suggestionEntries,snapshotFacts(snapshot),snapshot.id);
  const applicabilityRevisions=await db.prepare(`SELECT r.* FROM control_applicability_revisions r
    JOIN (SELECT entry_id,MAX(evaluated_at) AS evaluated_at FROM control_applicability_revisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? GROUP BY entry_id) latest
      ON latest.entry_id=r.entry_id AND latest.evaluated_at=r.evaluated_at
    WHERE r.workspace_id=? AND r.project_id=? AND r.system_snapshot_id=? ORDER BY r.entry_id`).all(project.workspace_id,project.id,snapshot.id,project.workspace_id,project.id,snapshot.id);
  const evidence=await db.prepare('SELECT * FROM control_evidence_items WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY observed_at DESC LIMIT 250').all(project.workspace_id,project.id,snapshot.id);await verifyRows(evidence,'integrity_digest','evidence');
  const decisions=await db.prepare('SELECT * FROM control_deployment_decisions WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY decided_at DESC LIMIT 1').all(project.workspace_id,project.id,snapshot.id);await verifyRows(decisions,'decision_digest','decision');
  const findings=await db.prepare(`SELECT r.id,r.status,r.severity,b.entry_id FROM remediation_items r JOIN control_finding_bindings b ON b.finding_id=r.id AND b.workspace_id=? AND b.project_id=? AND b.system_snapshot_id=? ORDER BY r.updated_at DESC LIMIT 250`).all(project.workspace_id,project.id,snapshot.id);
  const applicable=evaluations.filter(row=>row.applicability_status==='applicable');const observed=new Set(evidence.filter(row=>row.verification_state==='verified'&&row.retention_status==='active').map(row=>row.entry_id));const currentDecision=decisions[0]||null;
  const applicabilityDecisions=applicabilityRevisions.map(row=>({controlId:row.entry_id,decision:row.decision,reason:row.reason,architectureFacts:parseJson(row.architecture_facts_json,[]),evaluatedAt:row.evaluated_at,evaluatorRole:row.evaluator_role}));
  return {statement:'AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile ARL-RKA-1.2.0.',disclaimer:'This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.',project:{id:project.id,name:project.name},systemSnapshot:{id:snapshot.id,version:snapshot.version_identifier,digest:snapshot.content_digest},controlProfileVersion:'ARL-RKA-1.2.0',controlProfileDigest:intelligenceDigest(evaluations.map(row=>({id:row.entry_id,digest:row.entry_digest}))),suggestionProfile:suggestionProfile(),suggestions,scope:{included:'Current snapshot-bound controls and evidence.',exclusions:'Historical or unbound evidence does not qualify.'},controlsReviewed:applicabilityDecisions.length,applicabilityDecisions,applicableControls:applicable.length,notApplicableControls:applicabilityDecisions.filter(row=>row.decision==='not_applicable').length,contextRequiredControls:applicabilityDecisions.filter(row=>row.decision==='context_required').length,unevaluatedApplicableControls:applicable.filter(row=>row.severity_status==='not_evaluated').length,observedControls:observed.size,missingEvidence:applicable.filter(row=>!observed.has(row.entry_id)).map(row=>row.entry_id),openFindings:findings.filter(row=>!['verified_closed','accepted_risk'].includes(row.status)).map(row=>({id:row.id,controlId:row.entry_id,status:row.status,severity:row.severity})),retestStatus:{required:findings.filter(row=>!['verified_closed','accepted_risk'].includes(row.status)).length},runtimeEvidence:evidence.filter(row=>row.evidence_class==='runtime').length,approvalEvidence:evidence.filter(row=>row.approval_id).length,deploymentDecision:currentDecision?serializeDecision(currentDecision):null,stale:Boolean(currentDecision&&currentDecision.status!=='current'),integrityFailures:0,limitations:['Architecture suggestions require evaluator confirmation and are not observed controls.','Candidate controls remain candidate content.','Framework mappings are informative and do not establish compliance.']};
}

function deriveChains(evaluations, data) {
  return evaluations.map((evaluation) => {
    const controlId = evaluation.entry_id;
    const tests = data.tests.filter((row) => row.entry_id === controlId);
    const evidence = data.evidence.filter((row) => row.entry_id === controlId);
    const links = data.links.filter((row) => row.entry_id === controlId);
    const findings = data.remediations.filter((row) => row.finding_key === controlId || row.finding_key?.startsWith(`${controlId}-`));
    const open = findings.filter((row) => !['verified_closed','accepted_risk'].includes(row.status));
    const remediating = open.some((row) => !['open'].includes(row.status));
    const passedRetest = tests.some((row)=>validRetest(row,data.tests,findings));
    const failed = tests.some((row) => row.result === 'failed');
    const passed = tests.some((row) => row.result === 'passed');
    const activeEvidence = evidence.some((row) => row.retention_status === 'active' && row.verification_state === 'verified');
    const runtimeRegression = links.some((row) => row.subject_type === 'runtime_event') && data.runtime.some((row) => row.decision === 'deny' && links.some((link) => link.subject_id === row.id));
    const approvalRequired=(data.requirements||[]).some(row=>row.entry_id===controlId);
    const executed=tests.filter(row=>row.result!=='planned');const latest=tests[0];const verifiedEvidence=evidence.some(row=>row.retention_status==='active'&&row.verification_state==='verified');
    const failureEvidence=evidence.some(row=>row.retention_status==='active'&&['unverified','verified'].includes(row.verification_state)&&row.test_execution_id&&tests.some(test=>test.id===row.test_execution_id&&test.result==='failed'));
    let chainStatus = 'applicable_unassessed';
    if (evaluation.stale_at) chainStatus = 'reassessment_required';
    else if (evaluation.applicability_status === 'unknown') chainStatus = 'context_required';
    else if (evaluation.applicability_status === 'not_applicable') chainStatus = 'not_applicable';
    else if (runtimeRegression) chainStatus = 'runtime_regression';
    else if (open.length && remediating) chainStatus = 'remediation_in_progress';
    else if (open.length || failed) chainStatus = 'finding_open';
    else if (passed && activeEvidence) chainStatus = 'controlled_with_evidence';
    else if (tests.length) chainStatus = failed ? 'test_failed' : 'test_planned';
    const reviewed=evaluation.decision_method==='guided_customer_review';const completedStages=[];const notRequiredStages=[];let currentStage='applicability';let nextAction='Review whether this control applies to this agent.';let deploymentImpact='no_impact_yet';
    if(reviewed)completedStages.push('applicability');
    if(evaluation.applicability_status==='not_applicable'&&reviewed){notRequiredStages.push('test','evidence','finding','remediation','retest','approval');currentStage='deployment_decision';nextAction='Review the project deployment decision.';deploymentImpact='not_applicable';}
    else if(evaluation.applicability_status==='unknown'||!reviewed){currentStage='applicability';nextAction='Provide missing architecture information and confirm applicability.';notRequiredStages.push('finding','remediation','retest','approval');deploymentImpact='hold';}
    else if(!tests.length){currentStage='test';nextAction='Record or run a test.';notRequiredStages.push('finding','remediation','retest',...(approvalRequired?[]:['approval']));deploymentImpact='hold';}
    else if(latest?.result==='planned'){currentStage='test';nextAction='Execute the planned test and record the observed result.';notRequiredStages.push('finding','remediation','retest',...(approvalRequired?[]:['approval']));deploymentImpact='hold';}
    else if(latest?.result==='inconclusive'){currentStage='test';nextAction='Resolve the inconclusive test with additional evidence or rerun it.';notRequiredStages.push('finding','remediation','retest',...(approvalRequired?[]:['approval']));deploymentImpact='hold';}
    else {completedStages.push('test');const failurePath=failed||open.length;const evidenceReady=failurePath?failureEvidence:verifiedEvidence;if(!evidenceReady){currentStage='evidence';nextAction=failurePath?'Attach observed evidence to the failed test.':'Attach verified observed evidence for the executed test.';deploymentImpact='hold';}else{completedStages.push('evidence');if(failurePath){if(!findings.length){currentStage='finding';nextAction='Create or link a finding for the failed test.';}else if(!remediating){completedStages.push('finding');currentStage='remediation';nextAction='Record and implement remediation.';}else if(!passedRetest){completedStages.push('finding','remediation');currentStage='retest';nextAction='Retest the exact original failure against the remediated snapshot.';}else{completedStages.push('finding','remediation','retest');currentStage=approvalRequired?'approval':'deployment_decision';nextAction=approvalRequired?'Complete the required exact-action approval.':'Review the project deployment decision.';}deploymentImpact='blocker';}else{notRequiredStages.push('finding','remediation','retest');currentStage=approvalRequired?'approval':'deployment_decision';nextAction=approvalRequired?'Complete the required exact-action approval.':'Review the project deployment decision.';deploymentImpact=approvalRequired?'hold':'satisfied';}}}
    if(approvalRequired&&data.approvals.some(row=>row.entry_id===controlId&&validApproval(row))){completedStages.push('approval');if(currentStage==='approval'){currentStage='deployment_decision';nextAction='Review the project deployment decision.';}}
    const stages=['applicability','test','evidence','finding','remediation','retest','approval','deployment_decision'];const stageStates=Object.fromEntries(stages.map(stage=>[stage,notRequiredStages.includes(stage)?'not_required':completedStages.includes(stage)?'complete':stage===currentStage?'current':'blocked']));
    const entry=data.entries?.find(row=>row.id===controlId),revision=data.revisions?.find(row=>row.entry_id===controlId);return { controlId,controlTitle:entry?.title||controlId,category:entry?.category||'Uncategorised',suggestion:data.suggestions?.find(row=>row.controlId===controlId),suggested:data.suggestions?.find(row=>row.controlId===controlId),applicabilityDigest:revision?.evaluation_digest||evaluation.content_digest, systemSnapshotId: evaluation.system_snapshot_id, applicabilityStatus: evaluation.applicability_status,
      severity: evaluation.contextual_severity, severityStatus: evaluation.severity_status, chainStatus, currentStage,nextAction,availableActions:currentStage==='applicability'?['assess_applicability']:currentStage==='test'?['record_test']:currentStage==='evidence'?['record_evidence']:[],completedStages,blockedStages:stages.filter(stage=>stageStates[stage]==='blocked'),notRequiredStages,missingRequirements:stageStates[currentStage]==='current'?[nextAction]:[],deploymentImpact,stageStates,missingStages:stages.filter(stage=>stageStates[stage]==='current'), stale: Boolean(evaluation.stale_at) };
  });
}

function snapshotFacts(snapshot){const config=parseJson(snapshot.assessment_configuration_json,{});return Array.isArray(config.architectureFacts)?config.architectureFacts:[];}

function buildGraph(access, snapshot, chains, data) {
  const nodes = [{ id: `project:${access.project.id}`, type: 'agent_system', label: access.project.name, status: access.project.status, href: `/control-intelligence.html?projectId=${encodeURIComponent(access.project.id)}` },
    { id: `snapshot:${snapshot.id}`, type: 'system_snapshot', label: `System ${snapshot.version_identifier}`, status: snapshot.status, version: snapshot.version_identifier, digest: snapshot.content_digest }];
  const edges = [edge(`project:${access.project.id}`, `snapshot:${snapshot.id}`, 'has_version')];
  const architecture = parseJson(snapshot.architecture_json, {});
  for (const component of safeComponents(architecture).slice(0, 25)) {
    const nodeId = `component:${snapshot.id}:${component.id}`;
    nodes.push({ id: nodeId, type: 'architecture_component', label: component.label, status: component.status || 'declared' });
    edges.push(edge(`snapshot:${snapshot.id}`, nodeId, 'contains'));
  }
  for (const boundary of safeTrustBoundaries(architecture).slice(0, 20)) {
    const nodeId = `boundary:${snapshot.id}:${boundary.id}`;
    nodes.push({ id: nodeId, type: 'trust_boundary', label: boundary.label, status: 'declared' });
    edges.push(edge(`snapshot:${snapshot.id}`, nodeId, 'contains'));
    for (const componentId of boundary.componentIds) edges.push(edge(`component:${snapshot.id}:${componentId}`, nodeId, 'crosses'));
  }
  for (const flow of safeDataFlows(architecture).slice(0, 25)) {
    const nodeId = `flow:${snapshot.id}:${flow.id}`;
    nodes.push({ id: nodeId, type: 'data_flow', label: flow.label, status: flow.classification });
    edges.push(edge(`snapshot:${snapshot.id}`, nodeId, 'contains'), edge(`component:${snapshot.id}:${flow.from}`, nodeId, 'sends'), edge(nodeId, `component:${snapshot.id}:${flow.to}`, 'delivers_to'));
  }
  for (const chain of chains) {
    const entry = data.entries.find((row) => row.id === chain.controlId);
    if (!entry) continue;
    const threatId = `threat:${chain.controlId}`; const controlNode = `control:${chain.controlId}`;
    nodes.push({ id: threatId, type: 'threat_scenario', label: threatScenarios({ problem_json: entry.problem_json })[0]?.label || `Threat addressed by ${chain.controlId}`, status: chain.chainStatus });
    nodes.push({ id: controlNode, type: 'control', label: entry.title, status: chain.chainStatus, version: entry.knowledge_version, digest: entry.content_digest,
      href: `/control-intelligence-control.html?projectId=${encodeURIComponent(access.project.id)}&controlId=${encodeURIComponent(chain.controlId)}` });
    edges.push(edge(`snapshot:${snapshot.id}`, threatId, 'exposed_to'), edge(threatId, controlNode, 'addressed_by'), edge(controlNode, `snapshot:${snapshot.id}`, 'applies_to'));
    if (entry.accountable_owner) {
      const ownerId = `owner:${clean(entry.accountable_owner, 100).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      nodes.push({ id: ownerId, type: 'accountable_role', label: entry.accountable_owner, status: 'accountable' });
      edges.push(edge(controlNode, ownerId, 'owned_by'));
    }
    const definition = data.checks.find((row) => row.entry_id === chain.controlId);
    if (definition) {
      const definitionId = `test-definition:${definition.id}`;
      nodes.push({ id: definitionId, type: 'test_definition', label: `${chain.controlId} canonical check`, status: entry.lifecycle_status, version: entry.knowledge_version, digest: definition.content_digest });
      edges.push(edge(controlNode, definitionId, 'verified_by'));
    }
    for (const test of data.tests.filter((row) => row.entry_id === chain.controlId).slice(0, 2)) {
      const testId = `test:${test.id}`; nodes.push({ id: testId, type: 'test_execution', label: `${test.execution_method} — ${test.result}`, status: test.result, digest: test.content_digest });
      edges.push(edge(testId, `test-definition:${test.check_id}`, 'executes'));
    }
    for (const evidence of data.evidence.filter((row) => row.entry_id === chain.controlId).slice(0, 2)) {
      const evidenceId = `evidence:${evidence.id}`; nodes.push({ id: evidenceId, type: 'evidence', label: `${evidence.evidence_class} evidence`, status: evidence.verification_state, digest: evidence.integrity_digest });
      edges.push(edge(evidence.test_execution_id ? `test:${evidence.test_execution_id}` : controlNode, evidenceId, 'produces'));
    }
    for (const finding of data.remediations.filter((row) => row.finding_key === chain.controlId || row.finding_key?.startsWith(`${chain.controlId}-`)).slice(0, 2)) {
      const findingId = `finding:${finding.id}`; const remediationId = `remediation:${finding.id}`;
      nodes.push({ id: findingId, type: 'finding', label: finding.title, status: finding.status });
      nodes.push({ id: remediationId, type: 'remediation', label: `Remediation for ${finding.title}`, status: finding.status });
      edges.push(edge(findingId, controlNode, 'affects'), edge(findingId, remediationId, 'remediated_by'));
    }
    const links = data.links.filter((row) => row.entry_id === chain.controlId);
    for (const runtime of data.runtime.filter((row) => links.some((link) => link.subject_type === 'runtime_event' && link.subject_id === row.id)).slice(0, 2)) {
      const runtimeId=`runtime:${runtime.id}`; nodes.push({ id:runtimeId,type:'runtime_decision',label:`Runtime ${runtime.decision}`,status:runtime.decision,digest:runtime.policy_digest });
      edges.push(edge(runtimeId,controlNode,'observes'));
    }
    for (const approval of data.approvals.filter((row) => links.some((link) => link.subject_type === 'approval' && link.subject_id === row.id)).slice(0, 2)) {
      const approvalId=`approval:${approval.id}`; nodes.push({ id:approvalId,type:'human_approval',label:`Approval for ${approval.tool_name}`,status:approval.status,digest:approval.action_digest });
      edges.push(edge(approvalId,controlNode,'authorizes_for'));
    }
  }
  for (const decision of data.decisions.filter((row) => row.system_snapshot_id === snapshot.id).slice(0, 1)) {
    const nodeId = `decision:${decision.id}`;
    nodes.push({ id: nodeId, type: 'deployment_decision', label: `Deployment: ${decision.decision}`, status: decision.status, digest: decision.decision_digest });
    edges.push(edge(nodeId, `snapshot:${snapshot.id}`, 'assesses'));
    for (const binding of data.decisionEvidence.filter((row)=>row.decision_id===decision.id)) edges.push(edge(`evidence:${binding.evidence_id}`,nodeId,binding.relationship==='blocks'?'blocks':'supports'));
  }
  return { nodes: dedupe(nodes), edges: edges.filter((item) => nodes.some((node) => node.id === item.from) && nodes.some((node) => node.id === item.to)) };
}

function summarizeChains(chains, data) {
  const reviewed=chains.filter(x=>x.completedStages.includes('applicability')).length;const applicable=chains.filter(x=>x.applicabilityStatus==='applicable'&&x.completedStages.includes('applicability'));
  return { catalogueControls:chains.length,reviewedControls:reviewed,notApplicableControls:chains.filter(x=>x.applicabilityStatus==='not_applicable'&&x.completedStages.includes('applicability')).length,contextRequiredControls:chains.filter(x=>x.applicabilityStatus==='unknown').length,suggestedControls:chains.filter(x=>x.suggested?.status==='suggested').length,applicableControls: applicable.length,
    controlsNeedingAssessment: chains.length-reviewed,
    controlsWithObservedEvidence: chains.filter((x) => x.chainStatus === 'controlled_with_evidence').length,
    controlsMissingEvidence: applicable.length?applicable.filter((x) => !x.completedStages.includes('evidence')).length:null,
    testsToRun:applicable.filter(x=>x.currentStage==='test').length,retestsRequired:chains.filter(x=>x.currentStage==='retest').length,approvalsRequired:chains.filter(x=>x.currentStage==='approval').length,
    reproducibleFindings: data.tests.filter((x) => x.result === 'failed').length,
    findingsAwaitingRemediation: data.remediations.filter((x) => !['verified_closed','accepted_risk'].includes(x.status)).length,
    completedRetests: data.remediations.filter((x) => ['retested','verified_closed'].includes(x.status)).length,
    runtimeControlObservations: data.links.filter((x) => x.subject_type === 'runtime_event').length,
    blockedUnsafeActions: data.runtime.filter((x) => x.decision === 'deny').length,
    approvalsPending: data.approvals.filter((x) => x.status === 'active' && Date.parse(x.expires_at) > Date.now()).length,
    deploymentBlockers: chains.filter((x) => ['blocker','integrity_failure'].includes(x.deploymentImpact)).length,
    nextAction:chains.find(x=>x.currentStage==='applicability')||chains.find(x=>x.currentStage!=='deployment_decision')||null };
}

async function requireAccess(projectId, userId, roles, lock=false) {
  const suffix=lock&&db.kind==='postgres'?' FOR UPDATE OF p':'';
  const row = await db.prepare(`SELECT p.*,m.role FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'${suffix}`).get(clean(projectId, 100), userId);
  if (!row || !roles.has(row.role)) throw forbidden('Project not found or permission denied.');
  return { project: row, role: row.role };
}
async function requireCurrentSnapshot(access, requestedId) {
  const row = requestedId
    ? await db.prepare("SELECT * FROM system_snapshots WHERE id=? AND workspace_id=? AND project_id=? AND status='current'").get(clean(requestedId, 100), access.project.workspace_id, access.project.id)
    : await db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current' ORDER BY created_at DESC LIMIT 1").get(access.project.workspace_id, access.project.id);
  if (!row) throw conflict('A current project system snapshot is required; stale snapshots cannot receive new evidence or decisions.');
  await verifySnapshot(row);
  return row;
}
function emptyGraph(access, limit, offset) { return { graphVersion: '1.0', project: { id: access.project.id, name: access.project.name, role: access.role }, systemSnapshot: null,
  controlProfileVersion: 'ARL-RKA-1.2.0', summary: { applicableControls: 0, controlsNeedingAssessment: 0, controlsWithObservedEvidence: 0, controlsMissingEvidence: 0, reproducibleFindings: 0, findingsAwaitingRemediation: 0, completedRetests: 0, runtimeControlObservations: 0, blockedUnsafeActions: 0, approvalsPending: 0, deploymentBlockers: 0 },
  deploymentState: null, items: [], total: 0, limit, offset, hasMore: false, filters: { chainStatus: [] }, nodes: [], edges: [], emptyState: ['Describe the agent architecture.','Confirm applicable controls.','Run or record tests.','Review evidence and findings.','Fix and retest.','Make a deployment decision.'] }; }
function serializeSnapshot(row) { return { id: row.id, projectId: row.project_id, versionIdentifier: row.version_identifier, status: row.status, contentDigest: row.content_digest,
  runtimePolicyVersion: row.runtime_policy_version, runtimePolicyDigest: row.runtime_policy_digest, autonomyLevel: row.autonomy_level, source: row.source, createdAt: row.created_at,
  architecture: parseJson(row.architecture_json, {}), models: parseJson(row.models_json, []), tools: parseJson(row.tools_json, []), identities: parseJson(row.identities_json, []), dataSources: parseJson(row.data_sources_json, []), networkAccess: parseJson(row.network_access_json, []), approvalConfiguration:parseJson(row.approval_configuration_json,{}),assessmentConfiguration:parseJson(row.assessment_configuration_json,{}) }; }
function serializeTest(row) { return { id: row.id, systemSnapshotId: row.system_snapshot_id, controlId: row.entry_id, checkId: row.check_id, checkDigest: row.check_digest, executionMethod: row.execution_method, result: row.result,executionKind:row.execution_kind,retestOfExecutionId:row.retest_of_execution_id,remediationId:row.remediation_id,originalSnapshotId:row.original_snapshot_id,
  expectedResult: row.expected_result, observedResult: row.observed_result, inputReference: row.input_reference, limitations: row.limitations, failureReason: row.failure_reason, findingId: row.finding_id, executorId: row.executor_id, startedAt: row.started_at, completedAt: row.completed_at, contentDigest: row.content_digest }; }
function serializeEvidence(row) { return { id: row.id, systemSnapshotId: row.system_snapshot_id, controlId: row.entry_id, testExecutionId: row.test_execution_id, findingId: row.finding_id,
  evidenceClass: row.evidence_class, sourceType: row.source_type, sourceReference: row.source_reference, observedAt: row.observed_at, integrityDigest: row.integrity_digest,
  sensitivityClassification: row.sensitivity_classification, retentionStatus: row.retention_status, verificationState: row.verification_state, limitations: row.limitations }; }
function serializeFinding(row, evaluation) { return { id: row.id, findingKey: row.finding_key, title: row.title,
  contextualSeverity: evaluation.contextual_severity, severityStatus: evaluation.severity_status, severityScope: 'project',
  status: row.status, owner: row.owner_email, dueAt: row.due_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
function serializeRuntime(row) { return { id: row.id, decision: row.decision, observedDecision: row.observed_decision, severity: row.severity, ruleIds: parseJson(row.rule_ids_json, []), toolName: row.tool_name,
  argumentDigest: row.argument_digest, policyVersion: row.policy_version, policyDigest: row.policy_digest, retestCriteriaId: row.retest_criteria_id, remediationId: row.remediation_id, retestSatisfied: row.retest_satisfied == null ? null : Boolean(row.retest_satisfied), createdAt: row.created_at }; }
function serializeApproval(row) { return { id: row.id, toolName: row.tool_name, environment: row.environment, actionDigest: row.action_digest, status: row.status, issuedAt: row.issued_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, runtimeEventId: row.runtime_event_id }; }
function serializeDecision(row) { return { id: row.id, systemSnapshotId: row.system_snapshot_id, controlProfileVersion: row.control_profile_version, decision: row.decision, status: row.status, rationale: row.rationale,
  summary: parseJson(row.summary_json, {}), decisionMethod: row.decision_method, decisionDigest: row.decision_digest, decidedAt: row.decided_at, expiresAt: row.expires_at, reassessmentTrigger: row.reassessment_trigger }; }
function threatScenarios(row) { const problem = parseJson(row.problem_json, {}); return [{ id: `threat:${row.entry_id || 'control'}`, label: problem.credible_failure_or_attack || problem.statement || 'Control-specific failure or attack scenario', affectedAssets: problem.affected_assets || [], trustBoundary: problem.trust_boundary || null }]; }
function safeComponents(architecture) { const items = Array.isArray(architecture?.components) ? architecture.components : []; return items.map((item, index) => ({ id: clean(item?.id, 80) || `component-${index + 1}`, label: clean(item?.label || item?.name, 160) || `Component ${index + 1}`, status: clean(item?.status, 40) })); }
function safeTrustBoundaries(architecture) { const items=Array.isArray(architecture?.trustBoundaries)?architecture.trustBoundaries:[]; return items.map((item,index)=>({ id:clean(item?.id,80)||`boundary-${index+1}`,label:clean(item?.label||item?.name,160)||`Trust boundary ${index+1}`,componentIds:(Array.isArray(item?.componentIds)?item.componentIds:[]).map((value)=>clean(value,80)).filter(Boolean) })); }
function safeDataFlows(architecture) { const items=Array.isArray(architecture?.dataFlows)?architecture.dataFlows:[]; return items.map((item,index)=>({ id:clean(item?.id,80)||`flow-${index+1}`,label:clean(item?.label||item?.name,160)||`Data flow ${index+1}`,from:clean(item?.from,80),to:clean(item?.to,80),classification:clean(item?.classification,40)||'unknown' })).filter((item)=>item.from&&item.to); }
function edge(from, to, type) { return { id: intelligenceDigest({ from, to, type }).slice(0, 24), from, to, type }; }
function dedupe(items) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function countValues(values) { return [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1, new Map())].map(([value,count]) => ({ value,count })).sort((a,b) => a.value.localeCompare(b.value)); }
function snapshotDescriptor({project,input}) { return {schema:'arl.system-snapshot.v1',workspaceId:project.workspace_id,projectId:project.id,architecture:input.architecture||{},models:input.models||[],tools:input.tools||[],identities:input.identities||[],dataSources:input.dataSources||[],networkAccess:input.networkAccess||[],autonomyLevel:clean(input.autonomyLevel,40)||'unknown',approvalConfiguration:input.approvalConfiguration||{},runtimePolicyVersion:project.policy_version||null,runtimePolicyDigest:project.policy_digest||null,assessmentConfiguration:input.assessmentConfiguration||{},source:clean(input.source,40)||'manual'}; }
function descriptorFromSnapshot(row){return {schema:'arl.system-snapshot.v1',workspaceId:row.workspace_id,projectId:row.project_id,architecture:parseJson(row.architecture_json,{}),models:parseJson(row.models_json,[]),tools:parseJson(row.tools_json,[]),identities:parseJson(row.identities_json,[]),dataSources:parseJson(row.data_sources_json,[]),networkAccess:parseJson(row.network_access_json,[]),autonomyLevel:row.autonomy_level,approvalConfiguration:parseJson(row.approval_configuration_json,{}),runtimePolicyVersion:row.runtime_policy_version||null,runtimePolicyDigest:row.runtime_policy_digest||null,assessmentConfiguration:parseJson(row.assessment_configuration_json,{}),source:row.source};}
async function verifySnapshot(row){const stored=parseJson(row.descriptor_json,null);const normalized=descriptorFromSnapshot(row);if(!stored||canonicalJson(stored)!==canonicalJson(normalized)||intelligenceDigest(normalized)!==row.content_digest)await integrityFailure(row,'system_snapshot','descriptor_or_normalized_mismatch');}
function descriptorFromTest(row){return {schema:'arl.control-test-execution.v2',workspaceId:row.workspace_id,projectId:row.project_id,systemSnapshotId:row.system_snapshot_id,evaluationId:row.evaluation_id,entryId:row.entry_id,checkId:row.check_id,checkDigest:row.check_digest,executionMethod:row.execution_method,result:row.result,expectedResult:row.expected_result,observedResult:row.observed_result,inputReference:row.input_reference||null,limitations:row.limitations,failureReason:row.failure_reason||null,findingId:row.finding_id||null,executionKind:row.execution_kind,retestOfExecutionId:row.retest_of_execution_id||null,remediationId:row.remediation_id||null,originalSnapshotId:row.original_snapshot_id||null,executorId:row.executor_id||null,startedAt:row.started_at,completedAt:row.completed_at||null};}
function descriptorFromEvaluation(row){return {schema:'arl.control-evaluation.v1',workspaceId:row.workspace_id,projectId:row.project_id,systemSnapshotId:row.system_snapshot_id,entryId:row.entry_id,controlProfileVersion:row.control_profile_version,entryDigest:row.entry_digest,applicabilityStatus:row.applicability_status,applicabilityReason:row.applicability_reason,contextualSeverity:row.contextual_severity||null,severityStatus:row.severity_status,evaluatorId:row.evaluator_id||null,decisionMethod:row.decision_method,evaluatedAt:row.evaluated_at};}
function descriptorFromEvidence(row){const d=parseJson(row.descriptor_json,{});return {...d,workspaceId:row.workspace_id,projectId:row.project_id,systemSnapshotId:row.system_snapshot_id,controlId:row.entry_id,testExecutionId:row.test_execution_id||null,findingId:row.finding_id||null,runtimeEventId:row.runtime_event_id||null,approvalId:row.approval_id||null,remediationArtifactId:row.remediation_artifact_id||null,remediationId:row.remediation_id||null,evidenceClass:row.evidence_class,sourceType:row.source_type,sourceReference:row.source_reference,observedAt:row.observed_at,collectorId:row.collector_id||null,sensitivityClassification:row.sensitivity_classification,retentionStatus:row.retention_status,verificationState:row.verification_state,limitations:row.limitations};}
function descriptorFromDecision(row){const d=parseJson(row.descriptor_json,{});return {...d,workspaceId:row.workspace_id,projectId:row.project_id,systemSnapshotId:row.system_snapshot_id,controlProfileVersion:row.control_profile_version,decision:row.decision,summary:parseJson(row.summary_json,{}),rationale:row.rationale,decisionMethod:row.decision_method,decisionMakerId:row.decision_maker_id||null,decidedAt:row.decided_at,expiresAt:row.expires_at||null,supersedesDecisionId:row.supersedes_decision_id||null,reassessmentTrigger:d.reassessmentTrigger||null};}
function descriptorFromBinding(row){const d=parseJson(row.descriptor_json,{});const base={...d,workspaceId:row.workspace_id,projectId:row.project_id,systemSnapshotId:row.system_snapshot_id,entryId:row.entry_id,bindingType:row.binding_type,createdAt:row.created_at};if(row.runtime_event_id)base.runtimeEventId=row.runtime_event_id;if(row.approval_id)base.approvalId=row.approval_id;if(row.approval_requirement_id)base.approvalRequirementId=row.approval_requirement_id;if(row.attribution_mapping_id)base.attributionMappingId=row.attribution_mapping_id;return base;}
async function verifyRows(rows,digestField,type){for(const row of rows){const stored=parseJson(row.descriptor_json,null);const normalized=type==='test'?descriptorFromTest(row):type==='evidence'?descriptorFromEvidence(row):type==='decision'?descriptorFromDecision(row):type==='evaluation'?descriptorFromEvaluation(row):type==='binding'?descriptorFromBinding(row):stored;if(!stored||canonicalJson(stored)!==canonicalJson(normalized)||intelligenceDigest(normalized)!==row[digestField])await integrityFailure(row,type,'descriptor_or_normalized_mismatch');}}
async function integrityFailure(row,recordType,reason){const workspaceId=row?.workspace_id||null;const projectId=row?.project_id||null;const recordId=row?.id||null;const fingerprint=intelligenceDigest({workspaceId,projectId,recordType,recordId,reason});const timestamp=nowIso();try{const inserted=await db.prepare(`INSERT INTO control_integrity_audit_dedup (fingerprint,workspace_id,project_id,record_type,record_id,first_seen_at,last_seen_at,occurrence_count) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(fingerprint) DO NOTHING`).run(fingerprint,workspaceId,projectId,recordType,recordId,timestamp,timestamp);if(Number(inserted.changes)===1)await db.prepare(`INSERT INTO security_audit_log (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('aud_'),workspaceId,projectId,'system',null,'control_intelligence.integrity_failure',recordType,recordId,JSON.stringify({integrityStatus:'failed',reason,systemSnapshotId:row?.system_snapshot_id||(recordType==='system_snapshot'?recordId:null),controlId:row?.entry_id||null}),timestamp);else await db.prepare('UPDATE control_integrity_audit_dedup SET last_seen_at=?,occurrence_count=occurrence_count+1 WHERE fingerprint=?').run(timestamp,fingerprint);}catch(auditError){console.error(JSON.stringify({event:'control_intelligence_integrity_audit_failed',recordType,recordId,projectId,errorCode:auditError?.code||'AUDIT_WRITE_FAILED'}));}throw Object.assign(new Error('Control Intelligence digest verification failed.'),{statusCode:503,code:'CONTROL_INTELLIGENCE_INTEGRITY_FAILURE'});}
async function findingForControl(access,snapshot,controlId,findingId,allowHistorical=false){if(!findingId)return null;const row=await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=? AND (finding_key=? OR finding_key LIKE ?)').get(clean(findingId,100),access.project.id,controlId,`${controlId}-%`);if(!row)return null;if(!allowHistorical){const failure=await db.prepare('SELECT id FROM control_test_executions WHERE finding_id=? AND workspace_id=? AND project_id=? AND entry_id=? AND system_snapshot_id=?').get(row.id,access.project.workspace_id,access.project.id,controlId,snapshot.id);if(!failure&&snapshot.status!=='current')return null;}return row;}
function validRetest(row,tests,findings){if(row.execution_kind!=='retest'||row.result!=='passed'||!row.retest_of_execution_id||!row.finding_id||!row.remediation_id||!row.original_snapshot_id)return false;const original=tests.find(x=>x.id===row.retest_of_execution_id);return Boolean(original&&original.result==='failed'&&original.entry_id===row.entry_id&&original.finding_id===row.finding_id&&original.system_snapshot_id===row.original_snapshot_id&&row.system_snapshot_id!==row.original_snapshot_id&&findings.some(f=>f.id===row.finding_id));}
function requiredApprovalControls(snapshot,applicable){const config=parseJson(snapshot.approval_configuration_json,{});const legacy=Array.isArray(config.requiredControlIds)?config.requiredControlIds:[];const actions=Array.isArray(config.requiredActions)?config.requiredActions.map(item=>item?.controlId):[];const ids=[...legacy,...actions].map(value=>clean(value,80)).filter(Boolean);return [...new Set(ids.filter(value=>applicable.some(e=>e.entry_id===value)))].sort();}
function validApproval(row){if(row.status!=='active'||row.consumed_at||row.revoked_at||Date.parse(row.expires_at)<=Date.now()||!row.approval_requirement_id)return false;const requirement=parseJson(row.requirement_descriptor,null);const binding=parseJson(row.binding_descriptor,null);if(!requirement||!binding||intelligenceDigest(requirement)!==row.requirement_digest||intelligenceDigest(binding)!==row.binding_digest||binding.requirementDigest!==row.requirement_digest||binding.actionDigest!==row.requirement_action_digest)return false;const expected=runtimeApprovalActionDigest({workspaceId:row.workspace_id,projectId:row.project_id,environment:row.environment,tool:requirement.action,arguments:requirement.parameters});return expected===row.action_digest;}
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function safeTime(value) { if (!value) return null; const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function validateSnapshotInput(input) { if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('System snapshot input must be an object.'); for (const key of Object.keys(input)) if (!SAFE_SNAPSHOT_KEYS.has(key)) throw badRequest(`Unsupported system snapshot field: ${key}.`); }
function rejectSensitive(value, path = '') { if (typeof value === 'string') { if (/(?:arl_live_[a-z0-9_\-]{12,}|\bBearer\s+[A-Za-z0-9._~+\/-]{16,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,})/i.test(value)) throw badRequest(`Secret-like value${path ? ` at ${path}` : ''} cannot be stored.`); return; } if (!value || typeof value !== 'object') return; for (const [key,item] of Object.entries(value)) { const next = path ? `${path}.${key}` : key; if (SECRET_KEY.test(key)) throw badRequest(`Sensitive field ${next} cannot be stored in a system snapshot or evidence descriptor.`); rejectSensitive(item, next); } }
async function audit(access, actorId, action, targetType, targetId, metadata = {}) { await db.prepare(`INSERT INTO security_audit_log (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('aud_'), access.project.workspace_id, access.project.id, 'user', actorId, action, targetType, targetId, JSON.stringify(metadata), nowIso()); }
function error(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }
function badRequest(message) { return error(message, 400); }
function forbidden(message) { return error(message, 403); }
function notFound(message) { return error(message, 404); }
function conflict(message) { return error(message, 409); }
