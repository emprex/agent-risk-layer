import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createRuntimeApproval, createSecurityProject } from '../src/control-plane.js';
import { applyProjectRiskKnowledgeProfile } from '../src/risk-knowledge.js';
import {
  canonicalJson, createSystemSnapshot, getControlIntelligence, getControlIntelligenceControl,
  getControlIntelligenceReportSummary, intelligenceDigest, recordControlEvidence, recordControlTestExecution, recordDeploymentDecision,
} from '../src/control-intelligence.js';
import { buildAssessmentReport } from '../src/report-service.js';

const randomId = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
const root=path.resolve(import.meta.dirname,'..');
async function fixture(label='ci') {
  const userId=randomId('usr_');const timestamp=nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)').run(userId,`${label}-${crypto.randomUUID()}@example.test`,'test-only',timestamp,timestamp);
  const workspace=await createWorkspace(userId,`${label} workspace`);
  const project=await createSecurityProject({userId,workspaceId:workspace.id,name:`${label} agent`,environment:'test'});
  await applyProjectRiskKnowledgeProfile({workspaceId:workspace.id,projectId:project.id,architectureFacts:{uses_tools:true,is_production:false},userId});
  return {userId,workspace,project};
}

test('system snapshots are deterministic, immutable and bind all control evaluations', async()=>{
  const f=await fixture('snapshot');
  assert.equal(canonicalJson({b:2,a:1}),'{"a":1,"b":2}');
  assert.equal(intelligenceDigest({b:2,a:1}),intelligenceDigest({a:1,b:2}));
  const input={architecture:{summary:'Support agent',components:[{id:'orchestrator',label:'Agent orchestrator'}]},models:[{provider:'test',model:'synthetic'}],tools:[{name:'ticket_read',access:'read'}],identities:[{role:'support-agent'}],dataSources:[{type:'synthetic-tickets',classification:'internal'}],networkAccess:[],autonomyLevel:'bounded',approvalConfiguration:{highImpact:'required'},assessmentConfiguration:{profile:'ARL-RKA-1.2.0'},source:'test'};
  const first=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input});
  assert.equal(first.created,true);assert.match(first.snapshot.contentDigest,/^[a-f0-9]{64}$/);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM control_snapshot_evaluations WHERE system_snapshot_id=?').get(first.snapshot.id)).count,108);
  const repeated=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input});
  assert.equal(repeated.created,false);assert.equal(repeated.snapshot.id,first.snapshot.id);
  await assert.rejects(()=>createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{apiKey:'must-not-store'}}}),/Sensitive field/i);
  const decision=await recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:first.snapshot.id,rationale:'Evidence review remains incomplete.'}});
  assert.equal(decision.decision,'hold');
  const second=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{...input,tools:[...input.tools,{name:'ticket_write',access:'write'}]}});
  assert.equal(second.created,true);assert.notEqual(second.snapshot.id,first.snapshot.id);
  assert.equal((await db.prepare('SELECT status FROM control_deployment_decisions WHERE id=?').get(decision.id)).status,'stale');
  assert.equal((await db.prepare('SELECT status FROM system_snapshots WHERE id=?').get(first.snapshot.id)).status,'superseded');
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM control_snapshot_evaluations WHERE system_snapshot_id=? AND stale_at IS NOT NULL').get(first.snapshot.id)).count,108);
  await assert.rejects(()=>recordControlEvidence({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:first.snapshot.id,evidenceClass:'declared',sourceType:'statement',sourceReference:'owner statement'}}),/stale snapshots/i);
});

test('control chain requires evidence, links failed tests to findings and derives deployment decisions',async()=>{
  const f=await fixture('chain');
  const {snapshot}=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'Tool agent',components:[]},tools:[{name:'synthetic_tool'}],source:'test'}});
  await assert.rejects(()=>recordControlTestExecution({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:snapshot.id,result:'failed',observedResult:'Unsafe action reached the dry-run adapter.'}}),/must link an existing project finding/i);
  const findingId=randomId('rem_');const timestamp=nowIso();
  await db.prepare(`INSERT INTO remediation_items (id,project_id,finding_key,title,severity,status,verification_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'open','{}',?,?,?)`)
    .run(findingId,f.project.id,'ARL-KB-053-test','Unsafe synthetic action','high',f.userId,timestamp,timestamp);
  const failed=await recordControlTestExecution({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:snapshot.id,result:'failed',executionMethod:'bounded_dry_run',observedResult:'Unsafe action reached the dry-run adapter.',failureReason:'Expected denial was absent.',findingId}});
  assert.equal(failed.findingId,findingId);
  const declared=await recordControlEvidence({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:snapshot.id,testExecutionId:failed.id,findingId,evidenceClass:'declared',sourceType:'review_note',sourceReference:'Reviewer statement',limitations:'Not independently observed.'}});
  assert.equal(declared.verificationState,'declared');
  const firstPage=await getControlIntelligence({projectId:f.project.id,userId:f.userId,limit:50});
  const graph=await getControlIntelligence({projectId:f.project.id,userId:f.userId,limit:50,offset:50});
  assert.equal(graph.total,108);assert.equal(graph.items.find(x=>x.controlId==='ARL-KB-053').chainStatus,'finding_open');
  assert.ok(graph.edges.every(edge=>graph.nodes.some(node=>node.id===edge.from)&&graph.nodes.some(node=>node.id===edge.to)));
  assert.deepEqual(firstPage.items.map(x=>x.controlId),[...firstPage.items.map(x=>x.controlId)].sort());
  const detail=await getControlIntelligenceControl({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId});
  assert.equal(detail.tests[0].checkDigest,detail.testDefinition.digest);assert.equal(detail.evidence[0].verificationState,'declared');assert.equal(detail.findings[0].id,findingId);
  await db.prepare('UPDATE control_evidence_items SET integrity_digest=? WHERE id=?').run('0'.repeat(64),declared.id);
  await assert.rejects(()=>getControlIntelligenceControl({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId}),/digest verification/i);
  await db.prepare('UPDATE control_evidence_items SET integrity_digest=? WHERE id=?').run(declared.integrityDigest,declared.id);
  const decision=await recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:snapshot.id,rationale:'The reproduced finding remains unresolved.'}});
  assert.equal(decision.decision,'hold');
  assert.notEqual(decision.decision,'proceed');
  await db.prepare("UPDATE control_snapshot_evaluations SET contextual_severity='critical',severity_status='evaluated' WHERE system_snapshot_id=? AND entry_id='ARL-KB-053'").run(snapshot.id);
  const evaluation=await db.prepare("SELECT * FROM control_snapshot_evaluations WHERE system_snapshot_id=? AND entry_id='ARL-KB-053'").get(snapshot.id);
  const evaluationDescriptor={...JSON.parse(evaluation.descriptor_json),contextualSeverity:'critical',severityStatus:'evaluated'};
  await db.prepare('UPDATE control_snapshot_evaluations SET descriptor_json=?,content_digest=? WHERE id=?').run(canonicalJson(evaluationDescriptor),intelligenceDigest(evaluationDescriptor),evaluation.id);
  const blocked=await recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:snapshot.id,rationale:'The evaluated Critical finding remains open.'}});
  assert.equal(blocked.decision,'do_not_deploy');
});

test('runtime evidence and exact-action approvals cannot cross snapshot boundaries',async()=>{
  const f=await fixture('runtime-binding');
  const first=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'Approval-bound agent'},tools:[{name:'synthetic.transfer'}],approvalConfiguration:{requiredActions:[{controlId:'ARL-KB-053',action:'synthetic.transfer',parameters:{target:'test-recipient',value:10},target:'test-recipient',value:10,reuseScope:'one_time'}]},source:'test'}});
  const approval=await createRuntimeApproval({projectId:f.project.id,userId:f.userId,controlId:'ARL-KB-053',systemSnapshotId:first.snapshot.id,toolCall:{name:'synthetic.transfer',arguments:{target:'test-recipient',value:10}}});
  const binding=await db.prepare('SELECT * FROM control_snapshot_runtime_bindings WHERE approval_id=?').get(approval.id);
  assert.equal(binding.system_snapshot_id,first.snapshot.id);
  assert.ok(binding.approval_requirement_id);assert.match(binding.content_digest,/^[a-f0-9]{64}$/);
  await assert.rejects(()=>createRuntimeApproval({projectId:f.project.id,userId:f.userId,controlId:'ARL-KB-053',systemSnapshotId:first.snapshot.id,toolCall:{name:'synthetic.transfer',arguments:{target:'changed-recipient',value:10}}}),/exact action/i);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM runtime_approvals WHERE project_id=?').get(f.project.id)).count,1);
  const second=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'Changed approval-bound agent'},tools:[{name:'synthetic.transfer',scope:'expanded'}],source:'test'}});
  await assert.rejects(()=>recordControlEvidence({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:second.snapshot.id,evidenceClass:'observed',sourceType:'runtime_approval',sourceReference:'Exact action approval record',approvalId:approval.id}}),/not bound to this project snapshot/i);
});

test('Control Intelligence enforces roles, tenant boundaries, bounded pagination and server-derived fields',async()=>{
  const owner=await fixture('owner');const outsider=await fixture('outsider');
  const {snapshot}=await createSystemSnapshot({projectId:owner.project.id,userId:owner.userId,input:{architecture:{summary:'Bounded agent'},source:'test'}});
  await assert.rejects(()=>getControlIntelligence({projectId:owner.project.id,userId:outsider.userId}),/permission denied/i);
  await assert.rejects(()=>recordControlEvidence({projectId:owner.project.id,controlId:'ARL-KB-001',userId:outsider.userId,input:{systemSnapshotId:snapshot.id,evidenceClass:'imported',sourceType:'reference',sourceReference:'cross tenant'}}),/permission denied/i);
  const viewerId=randomId('usr_');const timestamp=nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)').run(viewerId,`viewer-${crypto.randomUUID()}@example.test`,'test-only',timestamp,timestamp);
  await db.prepare(`INSERT INTO workspace_members (id,workspace_id,user_id,email,display_name,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'viewer','active',?,?)`).run(randomId('wsm_'),owner.workspace.id,viewerId,`viewer-${crypto.randomUUID()}@example.test`,'Viewer',timestamp,timestamp);
  assert.equal((await getControlIntelligence({projectId:owner.project.id,userId:viewerId,limit:10000})).limit,50);
  await assert.rejects(()=>recordControlTestExecution({projectId:owner.project.id,controlId:'ARL-KB-001',userId:viewerId,input:{systemSnapshotId:snapshot.id,result:'planned'}}),/permission denied/i);
  await assert.rejects(()=>recordDeploymentDecision({projectId:owner.project.id,userId:viewerId,input:{systemSnapshotId:snapshot.id,decision:'proceed'}}),/permission denied/i);
});

test('migration is additive, foreign-keyed and SQLite has no orphan graph records',async()=>{
  const migration=fs.readFileSync(path.join(root,'migrations/015_control_intelligence_graph.sql'),'utf8');
  assert.doesNotMatch(migration,/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
  for(const table of ['system_snapshots','control_snapshot_evaluations','control_test_executions','control_evidence_items','control_deployment_decisions','deployment_decision_evidence','control_snapshot_runtime_bindings']) assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(migration,/REFERENCES security_projects\(id\)/);
  assert.match(migration,/REFERENCES system_snapshots\(id\)/);
  assert.deepEqual(await db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('Control Intelligence UI has one clear navigation entry, text graph alternative and responsive boundaries',()=>{
  const overview=fs.readFileSync(path.join(root,'public/control-intelligence.html'),'utf8');
  const detail=fs.readFileSync(path.join(root,'public/control-intelligence-control.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/control-intelligence.css'),'utf8');
  const script=fs.readFileSync(path.join(root,'public/control-intelligence.js'),'utf8');
  assert.equal((overview.match(/>Control Intelligence<\/a>/g)||[]).length,0);
  assert.match(fs.readFileSync(path.join(root,'public/site-shell.js'),'utf8'),/Control Intelligence/);
  assert.match(overview,/Overview[\s\S]*Controls[\s\S]*Evidence chain[\s\S]*Deployment decision/);
  assert.match(script,/Relationships/);assert.match(script,/Nodes/);
  assert.doesNotMatch(script,/href=\\?"#controls/);assert.match(script,/expectedCurrentSnapshotId/);assert.match(script,/expectedCurrentDecisionId/);
  assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/overflow-x:auto/);
  for(const html of [overview,detail]){assert.match(html,/name="viewport"/);assert.match(html,/skip-link/);assert.match(html,/aria-label/);assert.doesNotMatch(html,/runtime_event|action_digest|workspace_id|token_digest/);}
});

test('current records are unique and stale compare-and-swap writers fail closed',async()=>{
  const f=await fixture('cas');const one=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'one'},source:'test'}});
  const two=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'two'},source:'test',expectedCurrentSnapshotId:one.snapshot.id}});
  await assert.rejects(()=>createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'stale writer'},source:'test',expectedCurrentSnapshotId:one.snapshot.id}}),/changed after this page/i);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM system_snapshots WHERE project_id=? AND status='current'").get(f.project.id)).count,1);
  const d1=await recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:two.snapshot.id,rationale:'first'}});
  const d2=await recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:two.snapshot.id,expectedCurrentDecisionId:d1.id,rationale:'second'}});
  await assert.rejects(()=>recordDeploymentDecision({projectId:f.project.id,userId:f.userId,input:{systemSnapshotId:two.snapshot.id,expectedCurrentDecisionId:d1.id,rationale:'stale'}}),/changed after this page/i);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM control_deployment_decisions WHERE project_id=? AND system_snapshot_id=? AND status='current'").get(f.project.id,two.snapshot.id)).count,1);
  assert.equal((await db.prepare('SELECT supersedes_decision_id FROM control_deployment_decisions WHERE id=?').get(d2.id)).supersedes_decision_id,d1.id);
});

test('same-project cross-control sources and normalized digest mutations are rejected',async()=>{
  const f=await fixture('scope');const {snapshot}=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'scope'},source:'test'}});const timestamp=nowIso();
  const findingId=randomId('rem_');await db.prepare(`INSERT INTO remediation_items (id,project_id,finding_key,title,severity,status,verification_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'open','{}',?,?,?)`).run(findingId,f.project.id,'ARL-KB-054-test','Other control','high',f.userId,timestamp,timestamp);
  await assert.rejects(()=>recordControlTestExecution({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:snapshot.id,result:'failed',observedResult:'failure',findingId}}),/must link/i);
  const planned=await recordControlTestExecution({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId,input:{systemSnapshotId:snapshot.id,result:'passed',observedResult:'safe result'}});
  await db.prepare("UPDATE control_test_executions SET observed_result='tampered' WHERE id=?").run(planned.id);
  await assert.rejects(()=>getControlIntelligenceControl({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId}),/digest verification/i);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM security_audit_log WHERE project_id=? AND action='control_intelligence.integrity_failure' AND target_id=?").get(f.project.id,planned.id)).count,1);
  await assert.rejects(()=>getControlIntelligenceControl({projectId:f.project.id,controlId:'ARL-KB-053',userId:f.userId}),/digest verification/i);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM security_audit_log WHERE project_id=? AND action='control_intelligence.integrity_failure' AND target_id=?").get(f.project.id,planned.id)).count,1);
  await db.prepare("UPDATE system_snapshots SET autonomy_level='tampered' WHERE id=?").run(snapshot.id);
  await assert.rejects(()=>getControlIntelligence({projectId:f.project.id,userId:f.userId}),/digest verification/i);
});

test('customer report includes exact Control Intelligence scope without certification claims',async()=>{
  const f=await fixture('report');const {snapshot}=await createSystemSnapshot({projectId:f.project.id,userId:f.userId,input:{architecture:{summary:'Report-bound agent'},source:'test'}});const timestamp=nowIso();const assessmentId=randomId('asm_');
  const result={score:55,riskBand:'Moderate',headline:'Review required.',decision:'HOLD',methodology:'Evidence-driven contextual assessment.',responses:[],findings:[],attackPaths:[],controls:[],recommendations:[]};
  await db.prepare(`INSERT INTO assessments (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'pro',?,?,0,?,?,?)`).run(assessmentId,f.userId,'Report agent','Test agent','{}',55,'Moderate',JSON.stringify(result),randomId('access_'),randomId('share_'),'arl-risk-v3.2',timestamp,timestamp);
  await db.prepare(`INSERT INTO remediation_items (id,project_id,assessment_id,finding_key,title,severity,status,verification_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'open','{}',?,?,?)`).run(randomId('rem_'),f.project.id,assessmentId,'ARL-KB-053-report','Report linkage','high',f.userId,timestamp,timestamp);
  const summary=await getControlIntelligenceReportSummary({projectId:f.project.id});assert.equal(summary.systemSnapshot.id,snapshot.id);assert.equal(summary.controlProfileVersion,'ARL-RKA-1.2.0');assert.match(summary.disclaimer,/not an accredited certification/i);
  const {report}=await buildAssessmentReport(assessmentId,'pro');assert.equal(report.controlIntelligence.systemSnapshot.digest,snapshot.contentDigest);assert.equal(report.controlIntelligence.deploymentDecision,null);assert.ok(report.controlIntelligence.missingEvidence.length>=0);assert.doesNotMatch(JSON.stringify(report.controlIntelligence),/certified|guaranteed security/i);
});
