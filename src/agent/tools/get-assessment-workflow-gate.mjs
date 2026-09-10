export function getAssessmentWorkflowGate({
  targetContextBinding,
  assessmentContextBinding
} = {}) {
  if (!targetContextBinding) {
    return {
      type: 'assessment_workflow_gate',
      canContinue: false,
      blockedAt: 'target_context_binding',
      reason: 'target_context_binding_required'
    };
  }

  if (targetContextBinding.verified !== true) {
    return {
      type: 'assessment_workflow_gate',
      canContinue: false,
      blockedAt: 'target_context_binding',
      reason:
        targetContextBinding.reason ||
        'target_context_binding_not_verified',
      bindingStatus:
        targetContextBinding.status || 'unknown'
    };
  }

  if (!assessmentContextBinding) {
    return {
      type: 'assessment_workflow_gate',
      canContinue: false,
      blockedAt: 'assessment_context_binding',
      reason: 'assessment_context_binding_required'
    };
  }

  if (assessmentContextBinding.verified !== true) {
    return {
      type: 'assessment_workflow_gate',
      canContinue: false,
      blockedAt: 'assessment_context_binding',
      reason:
        assessmentContextBinding.reason ||
        'assessment_context_binding_not_verified',
      bindingStatus:
        assessmentContextBinding.status || 'unknown'
    };
  }

  return {
    type: 'assessment_workflow_gate',
    canContinue: true,
    nextStage: 'evidence_plan',
    targetBindingStatus: 'verified',
    assessmentBindingStatus: 'verified'
  };
}
