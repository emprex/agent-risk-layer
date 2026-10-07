export const CONTROLLED_ASSURANCE_BASELINE_SCHEMA =
  'arl.assurance.controlled-baseline.v1';

export const UKAS_ROUTE_BASELINE = Object.freeze({
  accreditationBody: 'UKAS',
  routeStatus: 'ukas_confirmation_required',
  workingHypothesisStandard: 'ISO/IEC 17020:2026',
  alternativeRouteStandard: 'ISO/IEC 17065',
  currentActivity:
    'Human-led security assessment of AI agents, MCP integrations, tools, APIs and autonomous workflows.',
  sourceRecord:
    'ARL Accreditation Route & Scope Decision Record v0.1',
  sourceState:
    'CONTROLLED WORKING / UKAS CONFIRMATION REQUIRED',
  claimBoundary:
    'The accreditation route is not confirmed by UKAS. ISO/IEC 17020:2026 is a working readiness lens, not a granted scope or conformity claim.'
});

export const ORGANISATIONAL_ASSURANCE_BASELINE =
  Object.freeze([
    {
      id: 'impartiality_and_independence',
      label: 'Impartiality and independence arrangements',
      status:
        'controlled_baseline_open_route_dependent_limits',
      sourceRecord:
        'ARL-AASC Impartiality, Conflict of Interest & Independence Procedure v0.1',
      sourceState:
        'CONTROLLED PRE-ACCREDITATION OPERATIONAL BASELINE — HUMAN APPROVED 23 SEP 2026',
      openLimitations: [
        'Founder concentration/self-review risk remains open and route-dependent.',
        'Independent certification decision function is not established.'
      ]
    },
    {
      id: 'personnel_competence',
      label:
        'Personnel competence, qualification, training and monitoring records',
      status:
        'controlled_baseline_authorised_with_limits',
      sourceRecord:
        'ARL-AASC Competence & Authorisation Framework v0.1',
      sourceState:
        'CONTROLLED PRE-ACCREDITATION OPERATIONAL BASELINE — HUMAN APPROVED 23 SEP 2026',
      openLimitations: [
        'F01 and F03-F08 have bounded authorisations; this does not establish F09/F15 independence or F10 certification-decision authority.',
        'Independent reviewer capability remains route-dependent and not established.'
      ]
    },
    {
      id: 'method_validation',
      label:
        'Documented validation and control of assessment methods',
      status: 'controlled_validation_open',
      sourceRecord:
        'ARL-AASC Scheme Validation Plan v0.1 / VAL-PILOT-001 Working Pack / Closeout & Validation Analysis v0.1',
      sourceState:
        'CONTROLLED VALIDATION WORK — PILOT OPEN WITH LIMITATIONS',
      openLimitations: [
        'Pilot validation is not complete.',
        'Participant feedback and independent review remain incomplete.',
        'Open validation issues and control-specific retest work must not be suppressed.'
      ]
    },
    {
      id: 'records_and_confidentiality',
      label:
        'Record control, confidentiality and information-handling procedures',
      status:
        'controlled_baseline_implemented_current_boundary',
      sourceRecord:
        'ARL-AASC Evidence Handling & Integrity Procedure v0.1',
      sourceState:
        'CONTROLLED PRE-ACCREDITATION OPERATIONAL BASELINE — HUMAN APPROVED 23 SEP 2026',
      openLimitations: [
        'Pilot validation remains incomplete.',
        'Evidence sufficiency remains requirement-specific and consequential acceptance stays human-authorised.'
      ]
    },
    {
      id: 'complaints_and_appeals',
      label:
        'Complaints, challenges and appeals handling with independence safeguards',
      status:
        'controlled_baseline_implemented_with_open_decision_function',
      sourceRecord:
        'ARL-AASC Complaints & Appeals Procedure v0.1',
      sourceState:
        'CONTROLLED PRE-ACCREDITATION OPERATIONAL BASELINE — HUMAN APPROVED 23 SEP 2026',
      openLimitations: [
        'Appeals decision function is not established.',
        'Operational effectiveness still requires real-case or validation evidence.'
      ]
    },
    {
      id: 'management_system',
      label:
        'Management-system controls, internal audit and management review',
      status:
        'implemented_current_pre_accreditation_boundary',
      sourceRecord:
        'ARL-AASC Management System, Internal Audit & Management Review Procedure v0.1',
      sourceState:
        'CONTROLLED PRE-ACCREDITATION OPERATIONAL BASELINE — HUMAN APPROVED 23 SEP 2026',
      openLimitations: [
        'UKAS route acceptance remains external and unresolved.',
        'Implementation must continue to be demonstrated through live records, corrective action and review rather than document existence alone.'
      ]
    }
  ]);

export const OWASP_2026_COVERAGE_TARGETS =
  Object.freeze({
    agenticApplications: Object.freeze([
      'ASI01',
      'ASI02',
      'ASI03',
      'ASI04',
      'ASI05',
      'ASI06',
      'ASI07',
      'ASI08',
      'ASI09',
      'ASI10'
    ]),
    llmApplications: Object.freeze([
      'LLM01',
      'LLM02',
      'LLM03',
      'LLM04',
      'LLM05',
      'LLM06',
      'LLM07',
      'LLM08',
      'LLM09',
      'LLM10'
    ])
  });

export function controlledAssuranceBaseline() {
  return {
    schema: CONTROLLED_ASSURANCE_BASELINE_SCHEMA,
    ukasRoute: UKAS_ROUTE_BASELINE,
    organisationalEvidence:
      ORGANISATIONAL_ASSURANCE_BASELINE,
    owasp2026CoverageTargets:
      OWASP_2026_COVERAGE_TARGETS
  };
}
