// Review-ready projection of existing authoritative assessment diagnostics.
// Not an OWASP certification, UKAS accreditation claim, test result or evidence approval.
const FAMILIES = [
  ['staticCollection','static_candidate_review'],
  ['humanDocumentation','accountable_human_documentation'],
  ['runtimeValidation','separately_authorised_runtime_test'],
  ['manualReview','manual_triage']
];
export function buildAssessmentBatchReviewDossier({summary,review,preview}) {
  if (summary?.schema !== 'arl.agent.assessment-batch-run-summary.v1' ||
      review?.schema !== 'arl.agent.assessment-evidence-review-packs.v1' ||
      preview?.schema !== 'arl.agent.static-collection-preview.v1' ||
      !summary?.systemSnapshotId ||
      summary.systemSnapshotId !== review.systemSnapshotId ||
      summary.systemSnapshotId !== preview.systemSnapshotId ||
      summary.targetRevision !== preview.targetRevision ||
      summary.observationDigestSha256 !== preview.observationDigestSha256 ||
      summary.controlsTotal !== 108 || summary.controls?.length !== 108 ||
      summary.securityStateChanged !== false ||
      summary.deploymentDecisionWritten !== false ||
      summary.passFailInferred !== false ||
      review.securityStateChanged !== false ||
      review.deploymentDecisionWritten !== false ||
      review.boundaries?.evidenceAccepted !== false ||
      review.boundaries?.passFailInferred !== false ||
      review.boundaries?.runtimeTestingAuthorised !== false ||
      preview.evidencePersisted !== 0 || preview.testsExecuted !== 0 ||
      preview.passFailInferred !== false) {
    throw new Error('Batch review requires exact read-only authoritative assessment inputs.');
  }
  const controls = new Map(summary.controls.map(c=>[c.controlId,{
    controlId:c.controlId,lane:c.lane,eligible:c.staticBatchEligible,
    status:'human_review_required',requirements:[],lineageExceptions:[],
    decision:'not_determined'
  }]));
  if (controls.size !== 108 || [...controls].some(([id])=>!/^ARL-KB-\d{3}$/.test(id)))
    throw new Error('Incomplete canonical review control identity.');
  const seen = new Map();
  for (const [family,kind] of FAMILIES) {
    if (!Array.isArray(review[family])) throw new Error('Review pack family missing: '+family);
    for (const pack of review[family]) {
      if (!Array.isArray(pack.tasks)) throw new Error('Review pack tasks required.');
      for (const task of pack.tasks) {
        const control = controls.get(task.controlId);
        if (!control || !control.eligible || !Number.isSafeInteger(task.requirementIndex) ||
            task.requirementIndex < 1 || typeof task.requirement !== 'string' ||
            !task.requirement.trim()) throw new Error('Review task outside canonical eligible control.');
        const key=task.controlId+':'+task.requirementIndex;
        const prior=seen.get(key);
        if (prior && (prior.kind !== kind || prior.requirement !== task.requirement))
          throw new Error('Conflicting classification of the same requirement.');
        if (prior) continue; // duplicate collector packets are not duplicate criteria
        const value={requirementIndex:task.requirementIndex,requirement:task.requirement,
          kind,reviewState:task.reviewState,
          candidateEvidenceIds:Array.isArray(task.candidateEvidenceIds)?task.candidateEvidenceIds:[],
          expectedCollectors:Array.isArray(task.expectedCollectors)?task.expectedCollectors:[]};
        seen.set(key,{kind,requirement:task.requirement});
        control.requirements.push(value);
      }
    }
  }
  if (!Array.isArray(preview.criteria) ||
      preview.criteria.some(c=>!controls.get(c.controlId)?.eligible ||
        c.criterionSatisfied !== false || c.evidenceVerified !== false))
    throw new Error('Static preview cannot confer validity or target excluded controls.');
  const staticByKey=new Map(preview.criteria.map(c=>[c.controlId+':'+c.requirementIndex,c]));
  if (staticByKey.size !== preview.criteria.length) throw new Error('Duplicate static preview criterion.');
  for (const control of controls.values()) {
    control.requirements.sort((a,b)=>a.requirementIndex-b.requirementIndex);
    for (const req of control.requirements) {
      if (req.kind !== 'static_candidate_review') continue;
      const candidate=staticByKey.get(control.controlId+':'+req.requirementIndex);
      if (!candidate) throw new Error('Static criterion missing from one-pass preview.');
      req.staticMetadataState=candidate.state;
      req.evidenceVerified=false;
    }
  }
  const exceptionRows=review.lineageExceptions || [];
  if (!Array.isArray(exceptionRows)) throw new Error('Lineage exceptions require explicit review.');
  for (const entry of exceptionRows) {
    const control=controls.get(entry.controlId);
    if (!control) throw new Error('Unbound lineage exception.');
    control.lineageExceptions.push({
      evidenceId:entry.evidenceId || null,
      lineageStatus:entry.lineageStatus,
      diagnosticLane:entry.diagnosticLane
    });
  }
  return {
    schema:'arl.agent.assessment-batch-review-dossier.v1',
    systemSnapshotId:summary.systemSnapshotId,
    targetRevision:summary.targetRevision,
    observationDigestSha256:summary.observationDigestSha256,
    scope:{controls:108,eligible:summary.eligibleControls,excluded:summary.excludedControls},
    criteria:preview.counts,
    controls:[...controls.values()],
    limitations:[
      'Static metadata is a candidate for independent human review, not verified evidence.',
      'No active or production tests are authorised by this dossier.',
      'Applicability, severity, finding closure and readiness require accountable human authority.',
      'No OWASP compliance certification or UKAS accreditation status is inferred.'
    ],
    testsExecuted:0,evidencePersisted:0,
    passFailInferred:false,securityStateChanged:false,
    deploymentDecisionWritten:false,humanReviewRequired:true
  };
}
