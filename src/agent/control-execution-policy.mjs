export function deriveControlExecutionPolicy({
  currentStage = null,
  caseId = null,
  testMode = null,
  automationStatus = null
} = {}) {
  if (currentStage !== 'test') {
    return {
      mode: 'not_test_stage',
      actor: null,
      requiresUserInput: false
    };
  }

  if (caseId) {
    return {
      mode: 'bounded_test',
      actor: 'user',
      requiresUserInput: true
    };
  }

  const normalizedMode = String(testMode || '').trim().toLowerCase();
  const normalizedAutomation = String(automationStatus || '').trim().toLowerCase();

  if (
    normalizedMode === 'manual' ||
    normalizedAutomation === 'unsupported'
  ) {
    return {
      mode: 'manual_evidence',
      actor: 'user',
      requiresUserInput: true
    };
  }

  /*
   * Candidate automation is not authoritative automation. Do not silently
   * execute a generic source review and pretend it is the control's test.
   */
  if (normalizedAutomation !== 'verified') {
    return {
      mode: 'manual_evidence',
      actor: 'user',
      requiresUserInput: true
    };
  }

  return {
    mode: 'automatic_test',
    actor: 'arl',
    requiresUserInput: false
  };
}
