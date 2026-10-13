// A non-execution disposition is an administrative operator statement, never
// evidence that an authorised security test ran or that the control passed.
export function requireAuthorisedTestNonExecution({
  state, detail, frozenInspection, controlId, reason, sourceReference
}) {
  const action = state?.nextAllowedAction || {};
  const snapshotId =
    state?.authoritativeArtifacts?.assessmentContext?.systemSnapshotId;
  const revision = frozenInspection?.target?.revision;
  if (!/^ARL-KB-\d{3}$/.test(controlId || '') ||
      typeof reason !== 'string' || reason.trim().length < 20 ||
      typeof sourceReference !== 'string' || !sourceReference.trim()) {
    throw new Error('Non-execution disposition requires controlId, a specific reason (20+ characters), and sourceReference.');
  }
  if (state?.stage !== 'authorised_active_test_execution_required' ||
      action.name !== 'perform_authorised_control_test' ||
      action.actor !== 'user' || action.requiresUserInput !== true ||
      action.controlId !== controlId || !action.authorisationReference) {
    throw new Error('Non-execution disposition requires the current authorised active-test gate.');
  }
  if (!snapshotId || !/^[a-f0-9]{40}$/.test(revision || '') ||
      frozenInspection?.binding?.verified !== true ||
      frozenInspection?.target?.dirty !== false ||
      frozenInspection?.binding?.revisionBefore !== revision ||
      frozenInspection?.binding?.revisionAfter !== revision ||
      detail?.systemSnapshot?.id !== snapshotId ||
      detail?.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== revision ||
      detail?.control?.id !== controlId ||
      detail?.chain?.currentStage !== 'test' ||
      ['passed', 'failed'].includes(detail?.chain?.status)) {
    throw new Error('Non-execution disposition requires the clean, matching, inconclusive test-stage frozen target.');
  }
  const authorised = (detail?.evidence || []).some(item =>
    item.sourceType === 'active_test_plan_authorisation' &&
    item.sourceReference === action.authorisationReference &&
    item.systemSnapshotId === snapshotId &&
    item.verificationState === 'verified' &&
    item.retentionStatus === 'active'
  );
  if (!authorised) throw new Error('Current-snapshot verified active-test authorisation is missing.');
  if ((detail?.tests || []).some(item =>
      item.systemSnapshotId === snapshotId &&
      ['authorised_local_active_test', 'authorised_manual_active_test'].includes(item.executionMethod))) {
    throw new Error('An authorised active test execution already exists; cannot claim test not executed.');
  }
  return {snapshotId, revision, authorisationReference: action.authorisationReference};
}
