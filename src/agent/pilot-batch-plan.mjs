// Conservative, read-only pilot plan. No result, test, or evidence is inferred.
export function buildPilotBatchPlan(queue, details, controlIds) {
  if (!queue?.complete || !queue.systemSnapshotId) throw new Error('Complete authoritative queue required.');
  if (!Array.isArray(controlIds) || controlIds.length === 0 || controlIds.length > 20 ||
      new Set(controlIds).size !== controlIds.length) throw new Error('Unique bounded pilot selection required.');
  const queueItems = new Map(Object.values(queue.lanes).flat().map(x => [x.controlId, x]));
  const detailById = new Map(details.map(x => [x?.control?.id, x]));
  const controls = controlIds.map(controlId => {
    const item = queueItems.get(controlId);
    const detail = detailById.get(controlId);
    if (!item || !detail || detail.systemSnapshot?.id !== queue.systemSnapshotId) {
      throw new Error('Pilot controls must bind to the exact authoritative snapshot.');
    }
    const blocked = item.lane === 'follow_up_blocked' || item.lane === 'human_decision';
    const tests = [...new Map([...(detail.tests || []), ...(detail.testHistory || [])]
      .filter(x => x?.id).map(x => [x.id, x])).values()];
    const evidence = [...new Map([...(detail.evidence || []), ...(detail.evidenceHistory || [])]
      .filter(x => x?.id).map(x => [x.id, x])).values()];
    return {
      controlId, title: detail.control?.title || null,
      lane: item.lane, chainStatus: item.chainStatus,
      nextAction: item.nextAction,
      existingTestIds: tests.map(x => x.id),
      existingEvidenceIds: evidence.map(x => x.id),
      proposedAction: blocked ? 'human_follow_up_only' :
        item.lane === 'test_planning' ? 'review_test_design_and_authorisation' :
        item.lane === 'evidence_collection' ? 'review_evidence_reuse_and_gaps' :
        'human_review_required',
      executionAuthorised: false
    };
  });
  return {
    schema: 'arl.agent.pilot-batch-plan.v1',
    systemSnapshotId: queue.systemSnapshotId,
    controlCount: controls.length,
    controls,
    executableTests: 0,
    evidenceAutomaticallyAccepted: 0,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
