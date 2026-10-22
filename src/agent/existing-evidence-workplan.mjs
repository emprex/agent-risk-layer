// Non-authoritative, bounded evidence-workplan projection for the local GUI.
// Source: canonical "Show assessment evidence requests" read-only workflow.
// Never copy raw requirement text, evidence IDs or collector/source payloads.
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const COUNT_KEYS=[
  'staticCandidates','staticMissing','humanRequirements',
  'runtimeRequirements','sourceLineageIssues'
];
const PACK_TYPES=[
  ['staticSourcePackets','static_observation'],
  ['humanDocumentPackets','human_document'],
  ['runtimeValidationPackets','runtime_authorisation'],
  ['manualReviewPackets','manual_review']
];
const validCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000;

export const EXISTING_EVIDENCE_SUMMARY_SCHEMA=
  'arl.operator.existing-evidence-workplan.v1';

export function existingEvidenceWorkplan({
  frozenRevision, binding=null, scopeBefore=null, scopeAfter=null,
  requests=null
}={}) {
  if (!SHA.test(frozenRevision||'')) throw new Error('Exact frozen revision required.');
  const base={
    schema:EXISTING_EVIDENCE_SUMMARY_SCHEMA,available:false,
    reason:'unavailable',securityStateChanged:false,
    deploymentDecisionWritten:false,humanReviewRequired:true,
    evidenceAccepted:false,testsExecuted:0,passFailInferred:false,
    readinessDecision:'not_evaluated'
  };
  if (!binding) return {...base,reason:'not_found'};
  if (scopeBefore?.available!==true || scopeAfter?.available!==true ||
      !ID.test(binding.projectId||'') ||
      !ID.test(binding.assessmentId||'') ||
      scopeBefore.projectId!==binding.projectId ||
      scopeAfter.projectId!==binding.projectId ||
      !ID.test(scopeBefore.systemSnapshotId||'') ||
      scopeBefore.systemSnapshotId!==scopeAfter.systemSnapshotId ||
      scopeBefore.targetBinding?.revision!==frozenRevision ||
      scopeAfter.targetBinding?.revision!==frozenRevision ||
      [scopeBefore,scopeAfter].some(x=>
        x.securityStateChanged!==false ||
        x.deploymentDecisionWritten!==false ||
        x.humanReviewRequired!==true))
    throw new Error('Evidence workplan refused stale scope or snapshot.');

  const summary=requests?.canonicalData?.assessmentEvidenceRequestSummary;
  const flags=requests?.canonicalData;
  if (!summary ||
      flags.securityStateChanged!==false ||
      flags.deploymentDecisionWritten!==false ||
      flags.humanReviewRequired!==true ||
      summary.snapshotId!==scopeBefore.systemSnapshotId)
    throw new Error('Canonical evidence workplan is unavailable or changed.');

  const totals=summary.summary;
  const numFields=[
    summary.controlsReviewed,summary.excludedControls,summary.criterionCount,
    ...COUNT_KEYS.map(key=>totals?.[key]),
    ...PACK_TYPES.map(([key])=>totals?.[key])
  ];
  if(numFields.some(x=>!validCount(x)) ||
     summary.controlsReviewed+summary.excludedControls!==108 ||
     !Array.isArray(summary.packs) ||
     summary.packs.length!==PACK_TYPES.reduce((n,[key])=>n+totals[key],0) ||
     summary.packs.length>150)
    throw new Error('Incomplete or malformed canonical evidence request inventory.');

  const packs=summary.packs.map((item,i)=>{
    if(item?.number!==i+1 || !validCount(item.taskCount) ||
       !validCount(item.controlCount) ||
       item.controlCount>summary.controlsReviewed)
      throw new Error('Malformed canonical evidence request pack.');
    let category='unknown';
    let at=i;
    for(const [key,label] of PACK_TYPES){
      if(at<totals[key]){category=label;break;}
      at-=totals[key];
    }
    if(category==='unknown')throw new Error('Evidence request pack category mismatch.');
    return {
      number:i+1,category,
      requirementInstances:item.taskCount,
      affectedControls:item.controlCount
    };
  });
  return {
    ...base,available:true,reason:null,
    projectId:binding.projectId,assessmentId:binding.assessmentId,
    systemSnapshotId:scopeBefore.systemSnapshotId,
    targetRevision:frozenRevision,
    assessmentControls:summary.controlsReviewed,
    otherWorkflowControls:summary.excludedControls,
    criterionCount:summary.criterionCount,
    counts:Object.fromEntries(COUNT_KEYS.map(key=>[key,totals[key]])),
    packs,
    interpretation:'Work plan counts and candidate observations only; no evidence was accepted and no control outcome was verified.'
  };
}
