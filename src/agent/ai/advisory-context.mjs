const ALLOWED_ACTION_FIELDS = [
  'name',
  'actor',
  'requiresUserInput',
  'controlId',
  'caseId'
];

function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source?.[field] !== undefined && source?.[field] !== null) {
      out[field] = source[field];
    }
  }
  return out;
}

function cleanText(value, max = 500) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

export function buildAdvisoryContext(canonicalData) {
  const workflowState = canonicalData?.workflowState || {};
  const scopedControl = workflowState?.scopedControl || {};
  const conversationResponse =
    canonicalData?.conversationResponse || {};

  return {
    schema: 'arl.ai.advisory-context.v1',
    advisoryOnly: true,
    stage: cleanText(workflowState.stage, 120),
    control: {
      controlId: cleanText(scopedControl.controlId, 120),
      title: cleanText(
        scopedControl.title ||
        scopedControl.name,
        240
      )
    },
    evidenceSummary: cleanText(
      workflowState.evidenceSummary ||
      conversationResponse.publicSummary,
      1200
    ),
    limitations: cleanText(
      workflowState.limitations ||
      conversationResponse.limitations,
      1200
    ),
    nextAllowedAction: pick(
      workflowState.nextAllowedAction || {},
      ALLOWED_ACTION_FIELDS
    ),
    humanReviewRequired: true
  };
}
