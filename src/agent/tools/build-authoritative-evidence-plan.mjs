import {
  buildEvidencePlan
} from '../../../public/evidence-plan.js';

export function buildAuthoritativeEvidencePlan({
  assessment,
  inspection,
  assessmentWorkflow
} = {}) {
  if (
    !assessmentWorkflow ||
    assessmentWorkflow.canContinue !== true
  ) {
    return {
      type: 'evidence_plan',
      available: false,
      reason: 'assessment_workflow_not_ready',
      blockedAt:
        assessmentWorkflow?.blockedAt ||
        'assessment_workflow'
    };
  }

  if (!assessment || typeof assessment !== 'object') {
    return {
      type: 'evidence_plan',
      available: false,
      reason: 'authoritative_assessment_required'
    };
  }

  if (!inspection || typeof inspection !== 'object') {
    return {
      type: 'evidence_plan',
      available: false,
      reason: 'source_inspection_required'
    };
  }

  const plan = buildEvidencePlan({
    assessment,
    inspections: [inspection]
  });

  return {
    type: 'evidence_plan',
    available: true,

    state: plan.state,
    title: plan.title,
    explanation: plan.explanation,

    checks: Array.isArray(plan.checks)
      ? plan.checks
      : [],

    manual: Array.isArray(plan.manual)
      ? plan.manual
      : [],

    resolved: Array.isArray(plan.resolved)
      ? plan.resolved
      : []
  };
}
