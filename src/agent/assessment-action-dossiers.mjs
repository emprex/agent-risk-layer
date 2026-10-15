// Deterministic, read-only worklist. Nothing here is a confirmed vulnerability.
export function buildAssessmentActionDossiers({mapping,inventory}) {
  if(mapping?.schema!=='arl.agent.assessment-evidence-requirement-map.v1' ||
     inventory?.schema!=='arl.agent.assessment-business-content-inventory.v1' ||
     mapping.controlsTotal!==108 || inventory.controlsTotal!==108 ||
     mapping.controls?.length!==108 || inventory.controls?.length!==108 ||
     mapping.projectId!==inventory.projectId ||
     mapping.snapshotId!==inventory.snapshotId ||
     mapping.targetRevision!==inventory.targetRevision ||
     mapping.passFailInferred!==false || mapping.evidenceAccepted!==false ||
     mapping.deploymentDecisionWritten!==false || mapping.securityStateChanged!==false ||
     inventory.passFailInferred!==false || inventory.evidenceAccepted!==false ||
     new Set(mapping.controls.map(c=>c.controlId)).size!==108 ||
     new Set(inventory.controls.map(c=>c.controlId)).size!==108)
    throw new Error('Action dossiers require complete same-scope decision-free assessment.');
  const descriptions=new Map(inventory.controls.map(c=>[c.controlId,c]));
  const controls=mapping.controls.map(c=>{
    const d=descriptions.get(c.controlId);
    if(!d || c.title!==d.title || c.workflowLane!==d.workflowLane ||
       c.requirements.length!==d.requiredEvidence.length ||
       c.requirements.some((r,i)=>r.requirement!==d.requiredEvidence[i] ||
         r.evidenceValidated!==false || r.requirementSatisfied!==false))
      throw new Error('Action dossier refuses mismatched or accepted evidence.');
    const requirements=c.requirements.map(r=>{
      if(!['static_metadata_candidate','no_exact_static_metadata_match'].includes(r.observationState) ||
         !Array.isArray(r.sourceArtifactSha256) || !Array.isArray(r.observedCollectorTypes))
        throw new Error('Invalid bounded observation state.');
      const hasCandidate=r.observationState==='static_metadata_candidate';
      if(hasCandidate !== (r.sourceArtifactSha256.length>0))
        throw new Error('Candidate requires traceable stored artifact.');
      return {
        requirementIndex:r.requirementIndex,
        expectedEvidence:r.requirement,
        availableObservation:hasCandidate
          ? 'Matching deterministic metadata candidate; content and security effectiveness not validated'
          : 'No exact match in the bounded static collection; external or human evidence may still exist',
        artifactDigests:r.sourceArtifactSha256,
        collectorTypes:r.observedCollectorTypes,
        boundedSourceFacts:r.boundedSourceFacts||[],
        proofStatus:'not_validated',
        actionType:c.workflowLane==='human_decision'?'accountable_human_review':
          hasCandidate?'inspect_candidate_and_validate_source':'request_evidence_or_authorised_verification',
        action:c.workflowLane==='human_decision'
          ? 'Accountable reviewer: inspect the authoritative governance and approval records for this exact requirement, record attributable decision and evidence reference.'
          : hasCandidate
            ? 'Examine the referenced source metadata and supporting primary material, verify scope and sufficiency, and document what it actually demonstrates.'
            : 'Obtain the specified evidence from the responsible owner; if runtime validation is necessary, agree an explicit safe scope and authorisation first.',
        acceptanceCriterion:'Accountable human records a version-bound review outcome with evidence reference and limitations; no automated acceptance.',
        requiresHumanDecision:true
      };
    });
    return {
      controlId:c.controlId,title:d.title,category:d.category,
      purpose:d.objective,assessmentMethod:d.method,
      documentedPassCondition:d.passCondition,
      documentedFailCondition:d.failCondition,
      methodLimitations:d.limitations,
      workflowLane:c.workflowLane,
      result:'undetermined',confirmedFinding:false,
      findingStatement:null,confirmedBusinessImpact:null,
      remediationStatus:'not_applicable_without_confirmed_finding',
      reviewRequirements:requirements,
      nextStep:c.workflowLane==='human_decision'
        ? 'Review accountable human decision records before concluding this control.'
        : 'Review mapped evidence candidates, acquire unmatched evidence, and separately authorise any required runtime testing.',
      humanReviewRequired:true
    };
  });
  return {
    schema:'arl.agent.assessment-action-dossiers.v1',
    projectId:mapping.projectId,snapshotId:mapping.snapshotId,
    targetRevision:mapping.targetRevision,controlsTotal:108,
    requirementsTotal:mapping.requirementsTotal,
    candidateRequirementCount:mapping.matchedRequirements,
    requiresEvidenceOrReviewCount:mapping.unmatchedRequirements,
    confirmedFindings:0,remediationPlansIssued:0,
    controls,
    note:'These are evidence acquisition, validation and assessment actions; not vulnerability findings or prescriptive fixes. Remediation plans require separately verified and human-approved findings.',
    securityStateChanged:false,deploymentDecisionWritten:false,
    evidenceAccepted:false,passFailInferred:false,humanReviewRequired:true
  };
}
