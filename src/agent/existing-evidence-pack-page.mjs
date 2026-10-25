// Read-only and deliberately non-authoritative projection of one canonical pack page.
// Never expose candidate evidence IDs, raw collector payloads or security decisions.
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const CONTROL=/^ARL-KB-[0-9]{3}$/;
const VALID_STATES=new Set([
  'static_observation_candidate_review_required',
  'static_observation_missing',
  'accountable_human_evidence_required',
  'authorised_runtime_evidence_required',
  'manual_triage_required'
]);
export const EVIDENCE_PACK_PAGE_SCHEMA='arl.operator.existing-evidence-pack-page.v1';

export function existingEvidencePackPage({
  frozenRevision,binding,scopeBefore,scopeAfter,requests,packNumber
}={}) {
  if (!SHA.test(frozenRevision||'') ||
      !ID.test(binding?.projectId||'') ||
      !ID.test(binding?.assessmentId||'') ||
      !ID.test(scopeBefore?.systemSnapshotId||'') ||
      scopeBefore?.available!==true || scopeAfter?.available!==true ||
      scopeBefore.projectId!==binding.projectId ||
      scopeAfter.projectId!==binding.projectId ||
      scopeBefore.systemSnapshotId!==scopeAfter.systemSnapshotId ||
      scopeBefore.targetBinding?.revision!==frozenRevision ||
      scopeAfter.targetBinding?.revision!==frozenRevision ||
      ![scopeBefore,scopeAfter].every(x=>
        x.securityStateChanged===false && x.deploymentDecisionWritten===false &&
        x.humanReviewRequired===true))
    throw new Error('Evidence pack refused stale assessment scope or target.');

  const payload=requests?.canonicalData?.assessmentEvidenceRequestPack;
  if (!payload || requests.canonicalData.securityStateChanged!==false ||
      requests.canonicalData.deploymentDecisionWritten!==false ||
      requests.canonicalData.humanReviewRequired!==true ||
      payload.snapshotId!==scopeBefore.systemSnapshotId ||
      payload.packNumber!==packNumber ||
      !Number.isSafeInteger(payload.packCount) || payload.packCount<1 ||
      payload.packCount>150 ||
      !Number.isSafeInteger(payload.pageNumber) || payload.pageNumber!==1 ||
      !Number.isSafeInteger(payload.pageCount) || payload.pageCount<1 ||
      !Number.isSafeInteger(payload.taskCount) || payload.taskCount<0 ||
      !Array.isArray(payload.controlSpecificReviewTasks) ||
      payload.controlSpecificReviewTasks.length>20 ||
      payload.securityStateChanged!==false ||
      payload.deploymentDecisionWritten!==false ||
      payload.humanReviewRequired!==true)
    throw new Error('Canonical evidence pack page is missing or malformed.');

  const tasks=payload.controlSpecificReviewTasks.map(task=>{
    if (!CONTROL.test(task?.controlId||'') ||
        !Number.isSafeInteger(task.requirementIndex) ||
        task.requirementIndex<1 || task.requirementIndex>100 ||
        typeof task.requirement!=='string' ||
        !task.requirement.trim() || task.requirement.length>3000 ||
        !VALID_STATES.has(task.reviewState) ||
        !Array.isArray(task.candidateEvidenceIds) ||
        !Array.isArray(task.expectedCollectors))
      throw new Error('Invalid canonical control-specific evidence task.');
    return {
      controlId:task.controlId,
      requirementIndex:task.requirementIndex,
      requirement:task.requirement,
      reviewState:task.reviewState,
      candidateCount:task.candidateEvidenceIds.length,
      humanReviewRequired:true
    };
  });
  return {
    schema:EVIDENCE_PACK_PAGE_SCHEMA,available:true,
    projectId:binding.projectId,assessmentId:binding.assessmentId,
    systemSnapshotId:scopeBefore.systemSnapshotId,
    targetRevision:frozenRevision,
    packNumber,pageNumber:1,pageCount:payload.pageCount,
    taskCount:payload.taskCount,tasks,
    evidenceAccepted:false,testsExecuted:0,passFailInferred:false,
    securityStateChanged:false,deploymentDecisionWritten:false,
    readinessDecision:'not_evaluated',humanReviewRequired:true
  };
}
