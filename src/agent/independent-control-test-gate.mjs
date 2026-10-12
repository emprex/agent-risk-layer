// Independent control selection is a *preflight*, not test authorisation or execution.
// Do not infer applicability, PASS/FAIL, evidence validity or finding closure here.
const SHA = /^[0-9a-f]{40}$/;
const CONTROL = /^ARL-KB-\d{3}$/;

export function assessIndependentControlTestGate({
  controlId, detail, frozenInspection, assessmentId, expectedSnapshotId
}) {
  const deny = reason => ({available:false, reason, controlId, securityStateChanged:false});
  if (!CONTROL.test(controlId || '')) return deny('Invalid canonical control ID.');
  const binding = detail?.systemSnapshot?.assessmentConfiguration;
  const target = binding?.targetBinding;
  const assessment = binding?.assessmentBinding;
  const revision = frozenInspection?.target?.revision;
  if (!SHA.test(revision || '') ||
      frozenInspection?.binding?.verified !== true ||
      frozenInspection?.target?.dirty !== false ||
      frozenInspection?.binding?.revisionBefore !== revision ||
      frozenInspection?.binding?.revisionAfter !== revision) {
    return deny('A verified clean exact frozen Git target is required.');
  }
  if (!expectedSnapshotId ||
      detail?.systemSnapshot?.id !== expectedSnapshotId ||
      detail?.control?.id !== controlId ||
      target?.source !== 'git' ||
      target?.revision !== revision ||
      assessment?.assessmentId !== assessmentId) {
    return deny('Control, assessment, snapshot or target SHA differs from authoritative binding.');
  }
  if (detail?.chain?.currentStage !== 'test') {
    return deny('Control is not at the authoritative test stage.');
  }
  if (detail?.testDefinition?.id !== 'ARL-CHK-' + controlId.slice(-3) ||
      !/^[0-9a-f]{64}$/.test(detail?.testDefinition?.digest || '') ||
      (!Array.isArray(detail?.testDefinition?.requiredEvidence) || !detail.testDefinition.requiredEvidence.length)) {
    return deny('Missing or mismatched canonical current test definition.');
  }
  return {
    available:true, controlId, systemSnapshotId:expectedSnapshotId,
    targetRevision:revision, checkId:detail.testDefinition.id,
    checkDigest:detail.testDefinition.digest,
    status:'preflight_only', runtimeTestAuthorised:false,
    testExecuted:false, evidenceVerified:false, securityStateChanged:false,
    deploymentDecisionWritten:false, humanReviewRequired:true
  };
}
