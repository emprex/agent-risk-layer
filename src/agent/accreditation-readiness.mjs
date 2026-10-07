export const ACCREDITATION_READINESS_SCHEMA =
  'arl.agent.accreditation-readiness.v1';

const CANDIDATE_ROUTE = Object.freeze({
  accreditationBody: 'UKAS',
  candidateStandard: 'ISO/IEC 17020:2026',
  candidateActivity: 'inspection-style AI-agent security assessment',
  status: 'candidate_route_not_confirmed',
  limitation:
    'The applicable UKAS accreditation route and scope must be confirmed with UKAS. This projection is readiness evidence only and is not accreditation, certification, legal advice, or proof of conformity.'
});

const PRODUCT_EVIDENCE = Object.freeze([
  {
    id: 'target_identity_and_version',
    label: 'Exact item identity and version',
    path:
      'authoritativeArtifacts.frozenTarget.revision',
    evidenceType: 'product'
  },
  {
    id: 'assessment_snapshot_binding',
    label: 'Assessment bound to an authoritative system snapshot',
    path:
      'authoritativeArtifacts.bindings.assessmentContextVerified',
    evidenceType: 'product'
  },
  {
    id: 'evidence_traceability',
    label: 'Control evidence is bound to control, snapshot and execution lineage',
    path:
      'authoritativeArtifacts.controlIntelligence.available',
    evidenceType: 'product'
  },
  {
    id: 'controlled_test_authority',
    label: 'Active or bounded testing remains subject to explicit authority',
    path:
      'workflow_authority_model',
    evidenceType: 'product'
  },
  {
    id: 'remediation_and_exact_retest',
    label: 'Failed conditions retain finding, remediation and exact-retest lineage',
    path:
      'workflow_lifecycle',
    evidenceType: 'product'
  },
  {
    id: 'human_final_decision',
    label: 'Final deployment decision remains accountable-human only',
    path:
      'humanReviewRequired',
    evidenceType: 'product'
  }
]);

const ORGANISATIONAL_EVIDENCE = Object.freeze([
  {
    id: 'impartiality_and_independence',
    label: 'Impartiality and independence arrangements',
    evidenceType: 'organisation'
  },
  {
    id: 'personnel_competence',
    label: 'Personnel competence, qualification, training and monitoring records',
    evidenceType: 'organisation'
  },
  {
    id: 'method_validation',
    label: 'Documented validation and control of assessment methods',
    evidenceType: 'organisation'
  },
  {
    id: 'records_and_confidentiality',
    label: 'Record control, confidentiality and information-handling procedures',
    evidenceType: 'organisation'
  },
  {
    id: 'complaints_and_appeals',
    label: 'Complaints, challenges and appeals handling with independence safeguards',
    evidenceType: 'organisation'
  },
  {
    id: 'management_system',
    label: 'Management-system controls, internal audit and management review',
    evidenceType: 'organisation'
  }
]);

function readPath(object, path) {
  return path
    .split('.')
    .reduce(
      (value, key) =>
        value == null ? undefined : value[key],
      object
    );
}

function productEvidenceState(workflowState, item) {
  if (item.path === 'workflow_authority_model') {
    return {
      status: 'implemented_in_product',
      evidence:
        'Bounded tests and exact retests require explicit workflow authority; automatic continuation is gated by actor and requiresUserInput.'
    };
  }

  if (item.path === 'workflow_lifecycle') {
    return {
      status: 'implemented_in_product',
      evidence:
        'Control Intelligence preserves finding, remediation, changed-snapshot and exact-retest stages.'
    };
  }

  const value =
    readPath(workflowState, item.path);

  if (
    value === true ||
    (typeof value === 'string' && value.trim())
  ) {
    return {
      status: 'observed_in_current_assessment',
      evidence: value
    };
  }

  return {
    status: 'not_observed_in_current_assessment',
    evidence: null
  };
}

export function buildAccreditationReadinessProjection({
  workflowState = null
} = {}) {
  const productEvidence =
    PRODUCT_EVIDENCE.map((item) => ({
      ...item,
      ...productEvidenceState(workflowState, item)
    }));

  const organisationalEvidence =
    ORGANISATIONAL_EVIDENCE.map((item) => ({
      ...item,
      status: 'documentary_evidence_required'
    }));

  const currentProductObserved =
    productEvidence.filter((item) =>
      [
        'implemented_in_product',
        'observed_in_current_assessment'
      ].includes(item.status)
    ).length;

  return {
    schema: ACCREDITATION_READINESS_SCHEMA,
    available: true,
    candidateRoute: CANDIDATE_ROUTE,
    technicalReferences: {
      owaspAgenticTop10: {
        role:
          'informative technical risk taxonomy and defensive-design reference',
        accreditationEvidence: false
      },
      owaspLlmTop10: {
        role:
          'informative LLM application risk taxonomy',
        accreditationEvidence: false
      }
    },
    productEvidence,
    organisationalEvidence,
    summary: {
      productEvidenceItems:
        productEvidence.length,
      productEvidenceObserved:
        currentProductObserved,
      organisationalEvidenceItems:
        organisationalEvidence.length,
      organisationalEvidenceComplete: 0,
      accreditationClaimPermitted: false,
      certificationClaimPermitted: false
    },
    limitations: [
      'OWASP mappings do not establish compliance, certification or accreditation.',
      'Product safeguards are only one part of conformity-assessment-body readiness; organisational competence, impartiality, management-system and records evidence remain separately required.',
      'Only UKAS can grant UKAS accreditation for an accepted scope.'
    ]
  };
}
