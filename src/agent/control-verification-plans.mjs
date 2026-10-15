import {collectControlEvidence} from './control-evidence-selection.mjs';

// Method hints are review procedures, not applicability decisions or attack
// results. Match the requirement and documented method, never a KB identifier.
const METHODS=[
 {kind:'identity_and_permissions',pattern:/\b(?:permissions?|privileges?|privileged|credentials?|identit(?:y|ies)|access[\s-]+controls?|oauth|api[\s-]+keys?|bearer[\s-]+tokens?|access[\s-]+tokens?|iam|roles?)\b/i,
  primary:'Versioned effective permission grants, identities, policies and approval records.',
  technical:'Reconcile principal, operation, resource and duration with the actual effective grants; check delegation and revocation against the approved task.',
  scenario:'A narrowly scoped, synthetic least-privilege or denied-action check in an authorised isolated environment.'},
 {kind:'tool_and_protocol',pattern:/\b(?:mcp|tools?|function[\s-]+calls?|agent[\s-]+to[\s-]+agent|a2a|protocols?|descriptors?|registr(?:y|ies))\b/i,
  primary:'Versioned runtime tool catalogue, interface schemas, allowlists and execution policy.',
  technical:'Reconcile declared tool names, arguments and destinations with the deployed registry and independent pre-execution enforcement.',
  scenario:'A bounded synthetic tool invocation comparing policy decision, attempted invocation and observed effect.'},
 {kind:'instruction_and_context',pattern:/\b(?:prompts?|injections?|memory|memories|retriev\w*|rag|contexts?|instructions?)\b/i,
  primary:'Versioned instruction hierarchy, data trust-boundary map and independent action policy.',
  technical:'Trace untrusted input or stored context to the action boundary; review how policy and human gates mediate a proposed action.',
  scenario:'An isolated synthetic untrusted-input case with recorded proposed action, gate decision and actual downstream effect.'},
 {kind:'supplier_and_dependency',pattern:/\b(?:dependenc(?:y|ies)|suppliers?|providers?|packages?|sbom|aibom|supply[\s-]+chain|lockfiles?|model[\s-]+(?:artifacts?|weights?|provenance|versions?))\b/i,
  primary:'Versioned dependency inventory, supplier approval, provenance and runtime component records.',
  technical:'Reconcile manifests and pinned artifacts against active components, approved providers, update paths and data destinations.',
  scenario:'An authorised staging-only component-integrity or change-detection exercise with rollback.'},
 {kind:'audit_and_monitoring',pattern:/\b(?:logs?|audits?|auditing|telemetry|monitoring|monitors?|alerts?|incidents?|traces?)\b/i,
  primary:'Timestamped policy, execution and monitoring records with retention and access rules.',
  technical:'Correlate attributable policy decisions, tool calls and actual results; identify gaps in event capture and retention.',
  scenario:'A synthetic event with expected detection, auditable timestamps and a documented observation window.'},
 {kind:'network_and_data_flow',pattern:/\b(?:networks?|egress|destinations?|exfiltrat\w*|data[\s-]+flows?|endpoints?|outbound)\b/i,
  primary:'Approved data-flow diagram, destination allowlist, network policy and scoped execution traces.',
  technical:'Reconcile configured destinations and data classifications against effective routing, outbound permissions and recorded transfers.',
  scenario:'A staging-only denied-destination or synthetic data-flow check using non-sensitive test data.'},
 {kind:'governance_and_approval',pattern:/\b(?:approvals?|approved|governance|human|risk[\s-]+owners?|decisions?|polic(?:y|ies)|authori[sz]\w*)\b/i,
  primary:'Dated authoritative policy, accountable approval and change-control record for the exact system version.',
  technical:'Validate ownership, scope, approval provenance, segregation of duties and whether the approved boundary matches the deployment.',
  scenario:'An isolated approval-gate workflow exercise only after written scope and consent.'}
];
// Cross-cutting documentary records are not authentication or tool-execution
// tests just because their text mentions identity, role, version or a tool.
// These hints do not accept evidence, decide applicability or trigger execution.
const DOCUMENTARY_REQUIREMENTS=[
 {kind:'assessment_scope_and_version',pattern:/^(?:exact\\s+)?assessed\\s+(?:system|production|version)\\b/i,
  primary:'Authoritative, version-bound system and assessment scope record.',
  technical:'Reconcile the project, system snapshot, frozen target revision, environment and declared scope with the actual version being reviewed; record any mismatch or unverified deployment identity.',
  scenario:null},
 {kind:'reviewer_record_provenance',pattern:/^(?:(?:accountable\\s+human\\s+)?reviewer|tester)\\s+identity\\b/i,
  primary:'Attributable human reviewer or tester record with role, timestamp and scope-bound evidence reference.',
  technical:'Verify reviewer or tester identity and role against the accountable record, confirm review time, scope and target revision, and reconcile the cited evidence digest without treating an assertion of identity as authentication.',
  scenario:null}
];
const FALLBACK={
 kind:'source_and_configuration',
 primary:'The versioned primary artifact specified in this requirement, including its owner and deployment context.',
 technical:'Inspect the exact primary source or live configuration read-only; compare documented expected behaviour with implementation and collection limits.',
 scenario:'A bounded staging-only behaviour check, if the analyst determines static review cannot settle the requirement.'
};
function assertDossier(d){
 if(d?.schema!=='arl.agent.assessment-action-dossiers.v1'||
  !d.projectId||!d.snapshotId||!/^[a-f0-9]{40}$/.test(d.targetRevision||'')||
  !Array.isArray(d.controls)||d.controls.length===0||d.controlsTotal!==d.controls.length||
  new Set(d.controls.map(c=>c.controlId)).size!==d.controls.length||
  d.humanReviewRequired!==true||d.passFailInferred!==false||
  d.evidenceAccepted!==false||d.securityStateChanged!==false||
  d.deploymentDecisionWritten!==false||d.confirmedFindings!==0||
  d.controls.some(c=>c.result!=='undetermined'||c.confirmedFinding!==false||
   c.humanReviewRequired!==true||!Array.isArray(c.reviewRequirements)||
   c.reviewRequirements.some(r=>r.proofStatus!=='not_validated'||
    r.requiresHumanDecision!==true)))
  throw new Error('Verification plans require a same-scope non-authoritative dossier.');
}
function methodFor(control,requirement){
 const primary=String(requirement.expectedEvidence||'');
 const normalized=primary.replace(/^ARL-KB-\\d{3}\\s+/i,'');
 const documentary=DOCUMENTARY_REQUIREMENTS.find(m=>m.pattern.test(normalized));
 if(documentary)return documentary;
 const fallbackContext=[control.assessmentMethod,control.purpose].filter(Boolean).join(' ');
 return METHODS.find(m=>m.pattern.test(primary))||
  METHODS.find(m=>m.pattern.test(fallbackContext))||FALLBACK;
}
function requirementPlan(control,selected){
 const {requirement,requirementIndex,artifactDigests,facts}=selected;
 if(!Number.isSafeInteger(requirementIndex)||requirementIndex<1||
  !String(requirement.expectedEvidence||'').trim())
  throw new Error('Verification requirement has no stable index or primary evidence description.');
 const method=methodFor(control,requirement);
 const hasCandidates=artifactDigests.length>0;
 return {
  requirementIndex,expectedEvidence:requirement.expectedEvidence,
  evidenceState:hasCandidates?'static_metadata_candidate_unvalidated':'no_matching_static_metadata',
  observed:{artifactSha256:artifactDigests,
   boundedScanCoverageState:selected.boundedScanCoverageState,
   boundedSourceFacts:facts.map(f=>({collector:f.collector,artifactSha256:f.artifactSha256,values:f.values})),
   description:hasCandidates?'Integrity-bound collection metadata candidate only; primary evidence not accepted.':
    'No matching metadata in this bounded collection; absence is not evidence of a control failure.'},
  unresolved:[
   'Applicability, primary-source authenticity and evidence sufficiency require accountable review.',
   'Effective deployed behaviour is not established by static metadata.',
   ...(selected.limitedCoverage?['This requirement has an incomplete or capped bounded source scan.']:[])
  ],
  primaryEvidenceNeeded:requirement.expectedEvidence,
  supportingEvidenceExample:method.primary,
  verification:{
   type:method.kind,
   documentary:'Obtain the exact versioned primary evidence, verify its origin and scope, and reconcile it with the recorded digest(s).',
   technical:method.technical,
   record:'Preserve reviewer, date, target revision, method, observations, artefacts, limitations and any independent test result.'
  },
  activeTest:{
// The human_decision lane can also contain technical controls whose static
   // collector is ineligible (e.g. SSRF or containment drills). Only the
   // governance-only category omits illustrative active verification.
   proposedScenario:control.workflowLane==='human_decision'&&
    control.category==='Governance and scope'?null:method.scenario,
   necessity:'analyst_to_determine',
   state:'blocked_no_verified_rules_of_engagement',
   executionAllowed:false,
   prerequisites:[
    'Explicit written rules of engagement and system-owner consent',
    'Exact target, version, environment and permitted operations',
    'Bounded test data, rollback or containment, and independent runtime approval'
   ],
   note:'This is a plan only. Authorisation and any execution belong to a separate enforced workflow.'
  },
  conclusionGate:{
   condition:requirement.acceptanceCriterion||
    'Accountable human validates primary evidence, applicable scope and observed behaviour.',
   requiresHumanDecision:true,
   findingConfirmed:false,
   evidenceAccepted:false,
   result:'undetermined',
   remediationOrClosureAllowed:false
  }
 };
}
// Pure, read-only plan generation. No network calls, test execution, AI
// inference, evidence acceptance, finding or deployment decision.
export function buildControlVerificationPlan(dossier,controlId){
 assertDossier(dossier);
 const selection=collectControlEvidence(dossier,controlId);
 if(!selection)throw new Error('Requested control is absent from this assessment scope.');
 const control=selection.control;
 const indices=selection.requirements.map(r=>r.requirementIndex);
 if(new Set(indices).size!==indices.length)throw new Error('Duplicate requirement index.');
 const requirements=selection.requirements.map(r=>requirementPlan(control,r));
 return {
  schema:'arl.agent.control-verification-plan.v1',
  projectId:dossier.projectId,snapshotId:dossier.snapshotId,targetRevision:dossier.targetRevision,
  controlId,title:control.title,purpose:control.purpose,assessmentMethod:control.assessmentMethod,
  coverage:{totalRequirements:selection.totalRequirements,
   candidateRequirements:selection.candidateRequirements,limitedCoverage:selection.limitedCoverage,
   methodLimitations:control.methodLimitations||null},
  requirements,
  authority:{planOnly:true,activeTestsExecuted:false,humanReviewRequired:true,
   findingsConfirmed:0,evidenceAccepted:false,securityStateChanged:false,
   deploymentDecisionWritten:false}
 };
}
export function buildAssessmentVerificationPlans(dossier){
 assertDossier(dossier);
 const plans=dossier.controls.map(c=>buildControlVerificationPlan(dossier,c.controlId));
 return {schema:'arl.agent.assessment-verification-plans.v1',projectId:dossier.projectId,
  snapshotId:dossier.snapshotId,targetRevision:dossier.targetRevision,
  plans,authority:{planOnly:true,activeTestsExecuted:false,humanReviewRequired:true,
   findingsConfirmed:0,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false}};
}
