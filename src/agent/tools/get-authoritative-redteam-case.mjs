import {
  TEST_CATALOG
} from '../../../redteam/agent-risk-redteam.mjs';

export function getAuthoritativeRedTeamCase({
  evidencePlan,
  caseId
} = {}) {
  if (!evidencePlan?.available) {
    return {
      type: 'authoritative_redteam_case',
      available: false,
      reason: 'authoritative_evidence_plan_required'
    };
  }

  const planned =
    (evidencePlan.checks || [])
      .find(
        (check) =>
          check?.caseId === caseId
      );

  if (!planned) {
    return {
      type: 'authoritative_redteam_case',
      available: false,
      reason: 'redteam_case_not_authorised_by_evidence_plan',
      caseId: caseId || null
    };
  }

  const testCase =
    TEST_CATALOG.find(
      (item) =>
        item.id === caseId
    );

  if (!testCase) {
    return {
      type: 'authoritative_redteam_case',
      available: false,
      reason: 'redteam_case_not_found_in_catalogue',
      caseId
    };
  }

  return {
    type: 'authoritative_redteam_case',
    available: true,
    caseId: testCase.id,
    title: testCase.title,
    category: testCase.category,
    severity: testCase.severity,
    objective: testCase.objective,
    detector: testCase.detector,
    evidencePlanCheckId:
      planned.id || null,
    questionId:
      planned.gap?.questionId || null
  };
}
