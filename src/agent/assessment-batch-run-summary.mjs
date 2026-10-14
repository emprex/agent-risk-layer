// An assessment-wide, read-only batch summary. The authoritative control queue
// is the sole source of control identity and workflow state.
const LANES = [
  'follow_up_blocked', 'human_applicability', 'test_planning',
  'evidence_collection', 'human_decision', 'review_required'
];

export function buildAssessmentBatchRunSummary({queue,index,review,preview}) {
  if (!queue?.complete || queue?.total !== 108 ||
      queue.expectedTotal !== 108 || !Array.isArray(queue.controlIds) ||
      queue.controlIds.length !== 108 ||
      new Set(queue.controlIds).size !== 108 ||
      !queue.controlIds.every((id,i) => id === 'ARL-KB-' + String(i+1).padStart(3,'0'))) {
    throw new Error('Assessment batch requires the complete canonical 108-control queue.');
  }
  if (queue.systemSnapshotId !== index?.systemSnapshotId ||
      queue.systemSnapshotId !== review?.systemSnapshotId ||
      queue.systemSnapshotId !== preview?.systemSnapshotId ||
      preview.schema !== 'arl.agent.static-collection-preview.v1' ||
      !/^[a-f0-9]{40}$/.test(preview.targetRevision || '') ||
      !/^[a-f0-9]{64}$/.test(preview.observationDigestSha256 || '') ||
      [queue,index,preview].some(x => x.securityStateChanged !== false ||
        x.deploymentDecisionWritten !== false || x.humanReviewRequired !== true) ||
      review.securityStateChanged !== false || review.deploymentDecisionWritten !== false ||
      index.eligibleControls + index.excludedControls !== 108 ||
      !Array.isArray(index.batches) || index.batches.length !== index.batchCount) {
    throw new Error('Assessment batch scope, snapshot or read-only boundaries mismatch.');
  }
  const controlLanes = new Map();
  for (const lane of LANES) {
    if (!Array.isArray(queue.lanes?.[lane])) throw new Error('Missing authoritative control lane.');
    for (const item of queue.lanes[lane]) {
      if (controlLanes.has(item.controlId)) throw new Error('Duplicate control across lanes.');
      controlLanes.set(item.controlId,lane);
    }
  }
  if (controlLanes.size !== 108 ||
      queue.controlIds.some(id=>!controlLanes.has(id))) throw new Error('Incomplete assessment control classification.');
  const eligible = new Set(index.batches.flatMap(batch => batch.controlIds));
  if (eligible.size !== index.eligibleControls ||
      [...eligible].some(id=>!['test_planning','evidence_collection'].includes(controlLanes.get(id)))) {
    throw new Error('Eligible batch controls do not match authoritative lanes.');
  }
  const criteria = preview.criteria || [];
  if (!Array.isArray(criteria) ||
      criteria.some(c=>!eligible.has(c.controlId) ||
        c.criterionSatisfied !== false || c.evidenceVerified !== false)) {
    throw new Error('Static preview includes out-of-scope or automatically verified criteria.');
  }
  return {
    schema:'arl.agent.assessment-batch-run-summary.v1',
    systemSnapshotId:queue.systemSnapshotId,
    targetRevision:preview.targetRevision,
    observationDigestSha256:preview.observationDigestSha256,
    controlsTotal:108,
    eligibleControls:eligible.size,
    excludedControls:108-eligible.size,
    staticCriteria:preview.counts,
    lanes:Object.fromEntries(LANES.map(lane=>[lane,queue.lanes[lane].length])),
    controls:queue.controlIds.map(controlId=>({
      controlId,
      lane:controlLanes.get(controlId),
      staticBatchEligible:eligible.has(controlId),
      result:'not_determined',
      humanReviewRequired:true
    })),
    testsExecuted:0,
    evidencePersisted:0,
    passFailInferred:false,
    securityStateChanged:false,
    deploymentDecisionWritten:false,
    humanReviewRequired:true
  };
}
