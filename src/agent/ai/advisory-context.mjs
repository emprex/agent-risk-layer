const KNOWN_FIELDS = [
  'frozenTargetVerified',
  'assessmentContextAvailable',
  'authoritativeAssessmentAvailable',
  'targetContextBound',
  'assessmentContextBound',
  'evidencePlanAvailable',
  'controlIntelligenceAvailable'
];

const REQUIRED_ACTION_FIELDS = [
  'actor',
  'label',
  'requiresUserInput'
];

const READINESS_FIELDS = [
  'available',
  'decision',
  'finalDeploymentDecisionMade'
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

function cleanTextList(value, maxItems = 8, maxLength = 500) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean);
}

export function isAssessmentStateExplanationRequest(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return [
    /^explain (?:the )?current assessment state[.!?]*$/,
    /^explain (?:the )?assessment state[.!?]*$/,
    /^explain where (?:we|i) (?:are|am)[.!?]*$/
  ].some((pattern) => pattern.test(text));
}

export function buildAdvisoryContext(canonicalData) {
  const workflowState = canonicalData?.workflowState || {};
  const scopedControl = workflowState?.scopedControl || {};
  const conversationResponse =
    canonicalData?.conversationResponse || {};
  const assessment =
    conversationResponse?.assessment || {};

  return {
    schema: 'arl.ai.advisory-context.v2',
    advisoryOnly: true,
    stage: cleanText(
      assessment.stage ||
      workflowState.stage,
      120
    ),
    control: {
      controlId: cleanText(scopedControl.controlId, 120),
      title: cleanText(
        scopedControl.title ||
        scopedControl.name,
        240
      )
    },
    known: pick(
      assessment.known || {},
      KNOWN_FIELDS
    ),
    remainsUnproven: cleanTextList(
      assessment.remainsUnproven
    ),
    requiredAction: pick(
      assessment.requiredAction || {},
      REQUIRED_ACTION_FIELDS
    ),
    readiness: pick(
      assessment.readiness || {},
      READINESS_FIELDS
    ),
    humanReviewRequired: true
  };
}
