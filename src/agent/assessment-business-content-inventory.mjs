// Read-only business-content inventory for the existing 108-control assessment.
// A source control's objective and expected tests are not observed findings.
export function buildAssessmentBusinessContentInventory({report,details}) {
  if(report?.schema!=='arl.agent.assessment-client-report.v1' ||
     report.reportStatus!=='draft_requires_accountable_human_review' ||
     report.passFailInferred!==false || report.evidenceAccepted!==false ||
     report.securityStateChanged!==false || report.deploymentDecisionWritten!==false ||
     report.controls?.length!==108 || !Array.isArray(details) || details.length!==108)
    throw new Error('Business content inventory requires complete decision-free assessment.');
  const byId=new Map(details.map(d=>[d?.control?.id,d]));
  if(byId.size!==108) throw new Error('Business detail inventory incomplete or duplicated.');
  const controls=report.controls.map(row=>{
    const d=byId.get(row.controlId);
    if(!d || d.systemSnapshot?.id!==report.systemSnapshotId ||
       d.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision!==report.targetRevision)
      throw new Error('Business detail source is outside current frozen target and snapshot.');
    const ctrl=d.control||{},test=d.testDefinition||{};
    const s=v=>typeof v==='string'?v.trim().slice(0,3000):'';
    const requirements=Array.isArray(test.requiredEvidence)?test.requiredEvidence:[];
    return {
      controlId:row.controlId,
      title:s(ctrl.title),
      category:s(ctrl.category),
      objective:s(test.objective),
      method:s(test.method),
      requiredEvidence:requirements.map(v=>s(v)).filter(Boolean).slice(0,30),
      passCondition:s(test.passCondition),
      failCondition:s(test.failCondition),
      limitations:s(test.limitations),
      applicabilityStatus:s(d.applicability?.status),
      contextualSeverityStatus:s(d.severity?.status),
      workflowLane:row.workflowLane,
      candidateStaticArtifactCount:row.staticArtifacts,
      criterionDescriptions:row.criteria.map(c=>c.index),
      verifiedFindingClaims:0,
      evidenceSufficiencyConfirmed:false,
      status:'requires_accountable_human_review'
    };
  });
  const missingByField=Object.fromEntries(
    ['title','objective','method','passCondition','failCondition'].map(field=>[
      field,controls.filter(c=>!c[field]).map(c=>c.controlId)
    ])
  );
  return {
    schema:'arl.agent.assessment-business-content-inventory.v1',
    projectId:report.projectId,snapshotId:report.systemSnapshotId,
    targetRevision:report.targetRevision,
    controlsTotal:108,
    controls,
    missingByField,
    note:'Knowledge descriptions and test criteria describe what to examine, not actual findings. Further bounded verified observation/evidence mapping is required before client findings.',
    securityStateChanged:false,deploymentDecisionWritten:false,
    passFailInferred:false,evidenceAccepted:false,humanReviewRequired:true
  };
}
