// Human-review-first client report: no certification, automatic risk score or verdict.
// All source data comes from the existing authoritative control review and integrity audit.
export function buildAssessmentClientReport({dossier,audit}) {
  if (dossier?.schema !== 'arl.agent.assessment-batch-review-dossier.v1' ||
      audit?.schema !== 'arl.agent.assessment-static-integrity-audit.v1' ||
      !dossier.systemSnapshotId ||
      dossier.systemSnapshotId !== audit.snapshotId ||
      dossier.targetRevision !== audit.targetRevision ||
      dossier.scope?.controls !== 108 || audit.controlsTotal !== 108 ||
      dossier.controls?.length !== 108 || audit.controls?.length !== 108 ||
      dossier.passFailInferred !== false || dossier.securityStateChanged !== false ||
      dossier.deploymentDecisionWritten !== false ||
      audit.passFailInferred !== false || audit.evidenceAccepted !== false ||
      audit.securityStateChanged !== false || audit.deploymentDecisionWritten !== false ||
      !audit.artifactIntegrityVerified || audit.controlsWithIntegrityFailures?.length ||
      audit.eligibleMissingArtifacts?.length) {
    throw new Error('Client report requires complete, cryptographically checked, decision-free assessment.');
  }
  const state=new Map(audit.controls.map(c=>[c.controlId,c]));
  if (state.size!==108 || new Set(dossier.controls.map(c=>c.controlId)).size!==108)
    throw new Error('Client report has duplicate control identities.');
  const controls=dossier.controls.map(c=>{
    const a=state.get(c.controlId);
    if (!a || a.lane!==c.lane || typeof a.storedArtifacts!=='number' ||
        c.decision!=='not_determined' || c.status!=='human_review_required' ||
        (c.eligible && a.storedArtifacts<1) ||
        (!c.eligible && c.lane!=='human_decision')) {
      throw new Error('Client report refuses mismatched control workflow or evidence.');
    }
    return {
      controlId:c.controlId,workflowLane:c.lane,
      staticArtifacts:a.storedArtifacts,
      artifactIntegrity:a.integrity,
      criteria:c.requirements.map(r=>({
        index:r.requirementIndex,kind:r.kind,
        reviewState:r.reviewState,staticMetadataState:r.staticMetadataState||null,
        humanVerificationRequired:true
      })),
      lineageExceptionCount:c.lineageExceptions.length,
      assessmentResult:'not_determined',
      nextAction:c.lane==='human_decision'
        ? 'Accountable human to inspect existing decision-stage evidence and approval record'
        : 'Review control-specific evidence and identify separately authorised runtime tests where required'
    };
  });
  const excluded=controls.filter(c=>c.workflowLane==='human_decision');
  if (excluded.length!==audit.excludedControls.length ||
      excluded.some(c=>!audit.excludedControls.some(x=>x.controlId===c.controlId)))
    throw new Error('Client report excludes or misstates decision-stage controls.');
  return {
    schema:'arl.agent.assessment-client-report.v1',
    reportStatus:'draft_requires_accountable_human_review',
    title:'AI Agent Security — Evidence Assessment (Draft)',
    projectId:audit.projectId,systemSnapshotId:audit.snapshotId,
    targetRevision:audit.targetRevision,
    summary:{
      totalControls:108,controlsWithStaticArtifacts:audit.eligibleWithArtifacts,
      decisionStageControls:excluded.length,
      sourceArtifactsIntegrityChecked:audit.storedArtifactCount,
      staticEvidenceIntegrityPassed:audit.artifactIntegrityVerified,
      controlsSecurityValidated:0
    },
    controls,
    limitations:[
      'Artifact SHA-256 integrity confirms stored bytes and frozen assessment scope, not adequacy or security.',
      'Static metadata observations are candidates requiring control-specific review.',
      'No active runtime testing or deployment authorisation was performed by this report.',
      'Nine decision-stage controls require examination of existing authoritative decision evidence.',
      'No OWASP certification, UKAS accreditation, PASS/FAIL or security readiness claim is made.'
    ],
    humanReviewRequired:true,evidenceAccepted:false,passFailInferred:false,
    securityStateChanged:false,deploymentDecisionWritten:false
  };
}
