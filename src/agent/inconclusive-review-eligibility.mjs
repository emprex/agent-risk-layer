// Pure gate for administrative inconclusive dispositions.
// Security controls remain inconclusive; only operator work-queue disposition changes.
export function requireInconclusiveReviewEvidence({
  detail, snapshotId, revision, frozenInspection, controlId
}) {
  if (!snapshotId || !/^[a-f0-9]{40}$/.test(revision || '') ||
      frozenInspection?.binding?.verified !== true ||
      frozenInspection?.target?.dirty !== false ||
      frozenInspection?.binding?.revisionBefore !== revision ||
      frozenInspection?.binding?.revisionAfter !== revision ||
      detail?.control?.id !== controlId ||
      detail?.systemSnapshot?.id !== snapshotId ||
      detail?.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== revision ||
      detail?.chain?.currentStage !== 'test' ||
      detail?.chain?.status === 'passed' ||
      detail?.chain?.status === 'failed') {
    throw new Error('Inconclusive disposition requires current clean frozen target and authoritative inconclusive test-stage control.');
  }
  const tests = [...(detail.tests || []), ...(detail.testHistory || [])];
  const evidence = [...(detail.evidence || []), ...(detail.evidenceHistory || [])];
  const reviewed = evidence.find(item =>
    item.systemSnapshotId === snapshotId &&
    item.controlId === controlId &&
    item.retentionStatus === 'active' &&
    item.verificationState === 'verified' &&
    item.sourceType === 'consolidated_human_review' &&
    item.evidenceClass === 'human_provided' &&
    tests.some(test =>
      test.id === item.testExecutionId &&
      test.systemSnapshotId === snapshotId &&
      test.controlId === controlId &&
      test.result === 'inconclusive' &&
      test.executionMethod === 'consolidated_human_review' &&
      test.inputReference === item.sourceReference)
  );
  if (!reviewed) {
    throw new Error('Inconclusive disposition requires linked, current-snapshot, verified human review evidence and an inconclusive human test.');
  }
  return reviewed;
}

export function isInconclusiveReviewAlreadyDocumented(rows, {projectId, controlId, snapshotId}) {
  return rows.some(row => {
    try {
      const event = JSON.parse(row.properties_json);
      return event.projectId === projectId &&
        event.controlId === controlId &&
        event.systemSnapshotId === snapshotId &&
        event.disposition === 'inconclusive_documented';
    } catch { return false; }
  });
}
