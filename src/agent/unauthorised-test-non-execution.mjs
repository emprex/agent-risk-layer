// Administrative operator disposition for an active test that was not authorised.
// This is not an execution authorisation, test result, or evidence of control compliance.
export function requireUnauthorisedTestNonExecution({
  state, detail, frozenInspection, controlId, reason, sourceReference
}) {
  const action = state?.nextAllowedAction || {};
  const snapshotId = state?.authoritativeArtifacts?.assessmentContext?.systemSnapshotId;
  const revision = frozenInspection?.target?.revision;
  if (!/^ARL-KB-\d{3}$/.test(controlId || '') ||
      typeof reason !== 'string' || reason.trim().length < 20 ||
      typeof sourceReference !== 'string' || sourceReference.trim().length < 3) {
    throw new Error('Unapproved non-execution requires controlId, specific reason (20+ characters) and sourceReference.');
  }
  if (state?.stage !== 'active_test_plan_required' ||
      action.name !== 'define_and_authorise_control_test' ||
      action.actor !== 'human' || action.requiresUserInput !== true ||
      action.controlId !== controlId || action.authorisationReference) {
    throw new Error('Unapproved non-execution is only permitted at the current human active-test planning gate.');
  }
  if (!snapshotId || !/^[a-f0-9]{40}$/.test(revision || '') ||
      frozenInspection?.binding?.verified !== true ||
      frozenInspection?.target?.dirty !== false ||
      frozenInspection?.binding?.revisionBefore !== revision ||
      frozenInspection?.binding?.revisionAfter !== revision ||
      detail?.control?.id !== controlId ||
      detail?.systemSnapshot?.id !== snapshotId ||
      detail?.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== revision ||
      detail?.chain?.currentStage !== 'test' ||
      ['passed','failed'].includes(detail?.chain?.status)) {
    throw new Error('Unapproved non-execution requires the current, clean, matching inconclusive frozen target.');
  }
  const allEvidence = [...(detail?.evidence || []), ...(detail?.evidenceHistory || [])];
  if (allEvidence.some(item =>
    item.systemSnapshotId === snapshotId &&
    item.sourceType === 'active_test_plan_authorisation' &&
    item.retentionStatus === 'active')) {
    throw new Error('An active-test authorisation already exists; use the authorised test workflow.');
  }
  const allTests = [...(detail?.tests || []), ...(detail?.testHistory || [])];
  if (allTests.some(item =>
    item.systemSnapshotId === snapshotId &&
    ['authorised_local_active_test','authorised_manual_active_test'].includes(item.executionMethod))) {
    throw new Error('An authorised active-test execution already exists; cannot claim test not executed.');
  }
  return {snapshotId, revision};
}
