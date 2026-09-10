import {
  inspectFrozenRepository
} from './inspect-frozen-repository.mjs';

import {
  getAssessmentContext
} from './get-assessment-context.mjs';

import {
  getAuthoritativeAssessment
} from './get-authoritative-assessment.mjs';

import {
  evaluateTargetContextBinding
} from './evaluate-target-context-binding.mjs';

import {
  evaluateAssessmentContextBinding
} from './evaluate-assessment-context-binding.mjs';

import {
  getAssessmentWorkflowGate
} from './get-assessment-workflow-gate.mjs';

import {
  buildAuthoritativeEvidencePlan
} from './build-authoritative-evidence-plan.mjs';

function assertFrozenInspection(frozenInspection) {
  if (
    frozenInspection?.type !== 'frozen_inspection' &&
    frozenInspection?.type !== 'frozen_inspection_transport'
  ) {
    throw new Error('frozenInspection is required');
  }
  if (!/^[a-f0-9]{40}$/i.test(String(frozenInspection?.target?.revision || ''))) {
    throw new Error('frozenInspection target revision is invalid');
  }
  if (frozenInspection?.target?.dirty === true) {
    throw new Error('Authoritative preparation requires a clean frozen target.');
  }
  if (frozenInspection?.binding?.verified !== true) {
    throw new Error('Verified frozen inspector binding is required.');
  }
  if (!frozenInspection?.inspection || typeof frozenInspection.inspection !== 'object') {
    throw new Error('Frozen source inspection is required.');
  }
  return frozenInspection;
}

export async function prepareAuthoritativeAssessmentWorkflowFromFrozenInspection({
  frozenInspection,
  projectId,
  userId,
  assessmentId
} = {}) {
  const frozen = assertFrozenInspection(frozenInspection);

  const assessmentContext =
    await getAssessmentContext({
      projectId,
      userId
    });

  const authoritativeAssessment =
    await getAuthoritativeAssessment({
      assessmentId,
      userId
    });

  const targetContextBinding =
    evaluateTargetContextBinding({
      target: frozen.target,
      assessmentContext
    });

  const assessmentContextBinding =
    evaluateAssessmentContextBinding({
      authoritativeAssessment,
      assessmentContext
    });

  const assessmentWorkflow =
    getAssessmentWorkflowGate({
      targetContextBinding,
      assessmentContextBinding
    });

  const evidencePlan =
    buildAuthoritativeEvidencePlan({
      assessment:
        authoritativeAssessment.available
          ? authoritativeAssessment
          : null,
      inspection: frozen.inspection,
      assessmentWorkflow
    });

  return {
    type: 'authoritative_assessment_preparation',
    target: frozen.target,
    inspectorBinding: frozen.binding,
    inspection: frozen.inspection,
    assessmentContext,
    authoritativeAssessment,
    targetContextBinding,
    assessmentContextBinding,
    assessmentWorkflow,
    evidencePlan,
    ready:
      assessmentWorkflow.canContinue === true &&
      evidencePlan.available === true
  };
}

export async function prepareAuthoritativeAssessmentWorkflow({
  repositoryPath,
  projectId,
  userId,
  assessmentId
} = {}) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  const frozen =
    await inspectFrozenRepository(
      repositoryPath
    );

  return prepareAuthoritativeAssessmentWorkflowFromFrozenInspection({
    frozenInspection: frozen,
    projectId,
    userId,
    assessmentId
  });
}
