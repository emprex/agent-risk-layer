// Read-only inventory and conservative gap classification. No security verdict.
export function buildPilotEvidenceGapMatrix(plan, details) {
  if (!plan?.systemSnapshotId || !Array.isArray(plan.controls) || !plan.controls.length)
    throw new Error('Snapshot-bound pilot plan required.');
  const index = new Map(details.map(detail => [detail?.control?.id, detail]));
  const controls = plan.controls.map(item => {
    const detail = index.get(item.controlId);
    if (!detail || detail.systemSnapshot?.id !== plan.systemSnapshotId)
      throw new Error('Evidence review must use the exact pilot snapshot.');
    const tests = [...new Map([...(detail.tests || []), ...(detail.testHistory || [])]
      .filter(x => x?.id).map(x => [x.id, x])).values()];
    const evidence = [...new Map([...(detail.evidence || []), ...(detail.evidenceHistory || [])]
      .filter(x => x?.id).map(x => [x.id, x])).values()];
    const current = evidence.filter(x => x.systemSnapshotId === plan.systemSnapshotId);
    const activeVerified = current.filter(x =>
      x.retentionStatus === 'active' && x.verificationState === 'verified');
    const activeUnverified = current.filter(x =>
      x.retentionStatus === 'active' && x.verificationState !== 'verified');
    const historicalOrRetired = evidence.filter(x =>
      x.systemSnapshotId !== plan.systemSnapshotId || x.retentionStatus !== 'active');
    const requiredEvidence = detail.testDefinition?.requiredEvidence || [];
    const latestResults = [...new Set(tests.filter(x => x.systemSnapshotId === plan.systemSnapshotId)
      .map(x => x.result).filter(Boolean))];
    return {
      controlId: item.controlId,
      title: item.title,
      chainStatus: item.chainStatus,
      checkId: detail.testDefinition?.id || null,
      objective: detail.testDefinition?.objective || null,
      method: detail.testDefinition?.method || null,
      requiredEvidence,
      passCondition: detail.testDefinition?.passCondition || null,
      failCondition: detail.testDefinition?.failCondition || null,
      testLimitations: detail.testDefinition?.limitations || null,
      recordedTestResults: latestResults,
      evidence: {
        verifiedCurrent: activeVerified.map(x => ({id:x.id,sourceType:x.sourceType,sourceReference:x.sourceReference,
          evidenceClass:x.evidenceClass,limitations:x.limitations})),
        unverifiedCurrent: activeUnverified.map(x => ({id:x.id,sourceType:x.sourceType,
          evidenceClass:x.evidenceClass,verificationState:x.verificationState})),
        historicalOrRetiredIds: historicalOrRetired.map(x => x.id)
      },
      gap: activeVerified.length === 0
        ? 'no_verified_current_evidence'
        : 'criterion_coverage_requires_human_review',
      recommendedNextStep: activeVerified.length === 0
        ? 'validate_existing_evidence_or_collect_qualifying_evidence'
        : 'human_check_each_required_criterion_against_verified_evidence',
      passInferred: false,
      testAuthorised: false
    };
  });
  return {
    schema:'arl.agent.pilot-evidence-gap-matrix.v1',
    systemSnapshotId:plan.systemSnapshotId,
    controlCount:controls.length,
    controls,
    securityStateChanged:false,
    deploymentDecisionWritten:false,
    humanReviewRequired:true
  };
}
