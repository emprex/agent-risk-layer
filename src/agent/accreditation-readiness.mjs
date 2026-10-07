import {
  UKAS_ROUTE_BASELINE,
  ORGANISATIONAL_ASSURANCE_BASELINE
} from './controlled-assurance-baseline.mjs';

export const ACCREDITATION_READINESS_SCHEMA =
  'arl.agent.accreditation-readiness.v1';

const CANDIDATE_ROUTE = Object.freeze({
  accreditationBody:
    UKAS_ROUTE_BASELINE.accreditationBody,
  candidateStandard:
    UKAS_ROUTE_BASELINE.workingHypothesisStandard,
  alternativeRouteStandard:
    UKAS_ROUTE_BASELINE.alternativeRouteStandard,
  candidateActivity:
    'inspection-style AI-agent security assessment',
  status:
    UKAS_ROUTE_BASELINE.routeStatus,
  sourceRecord:
    UKAS_ROUTE_BASELINE.sourceRecord,
  sourceState:
    UKAS_ROUTE_BASELINE.sourceState,
  limitation:
    UKAS_ROUTE_BASELINE.claimBoundary
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

const ORGANISATIONAL_EVIDENCE =
  ORGANISATIONAL_ASSURANCE_BASELINE;


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
      evidenceType: 'organisation',
      accreditationEvidence: false,
      certificationEvidence: false
    }));

  const currentProductObserved =
    productEvidence.filter((item) =>
      [
        'implemented_in_product',
        'observed_in_current_assessment'
      ].includes(item.status)
    ).length;

  const organisationalControlled =
    organisationalEvidence.filter((item) =>
      String(item.status || '').startsWith(
        'controlled_'
      ) ||
      String(item.status || '').startsWith(
        'implemented_'
      )
    ).length;

  const organisationalOpenLimitations =
    organisationalEvidence.reduce(
      (count, item) =>
        count +
        (Array.isArray(item.openLimitations)
          ? item.openLimitations.length
          : 0),
      0
    );

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
      organisationalEvidenceControlled:
        organisationalControlled,
      organisationalOpenLimitations,
      organisationalEvidenceComplete: 0,
      accreditationClaimPermitted: false,
      certificationClaimPermitted: false
    },
    limitations: [
      'OWASP mappings do not establish compliance, certification or accreditation.',
      'Controlled organisational procedures and records exist, but document existence is not equivalent to route-specific conformity or demonstrated continuing effectiveness.',
      'Only UKAS can grant UKAS accreditation for an accepted scope.'
    ]
  };
}
