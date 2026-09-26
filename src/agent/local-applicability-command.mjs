const PREFIX = 'Set control applicability ';

const DECISIONS = new Set([
  'applicable',
  'not_applicable',
  'context_required'
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function parseLocalApplicabilityCommand(request) {
  const text = clean(request);
  if (!text) return null;

  const shorthand = text.match(/^Control (ARL-KB-\d+) applies$/i);
  if (shorthand) {
    return {
      controlId: shorthand[1].toUpperCase(),
      decision: 'applicable',
      reason: 'Explicit local human applicability review',
      architectureFactIds: null
    };
  }

  if (!text.startsWith(PREFIX)) return null;

  let input;
  try {
    input = JSON.parse(text.slice(PREFIX.length));
  } catch {
    throw new Error(
      'Set control applicability requires a valid JSON object.'
    );
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      'Set control applicability requires a JSON object.'
    );
  }

  const controlId = clean(input.controlId).toUpperCase();
  if (!/^ARL-KB-\d{3}$/.test(controlId)) {
    throw new Error(
      'Set control applicability requires a valid ARL-KB-### controlId.'
    );
  }

  const decision = clean(input.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    throw new Error(
      'Applicability decision must be applicable, not_applicable, or context_required.'
    );
  }

  const reason = clean(input.reason);
  if (
    ['not_applicable', 'context_required'].includes(decision) &&
    reason.length < 10
  ) {
    throw new Error(
      'Not-applicable and context-required decisions require a specific reason of at least 10 characters.'
    );
  }

  let architectureFactIds = null;
  if (Object.hasOwn(input, 'architectureFactIds')) {
    if (!Array.isArray(input.architectureFactIds)) {
      throw new Error(
        'architectureFactIds must be an array of confirmed architecture fact IDs.'
      );
    }
    architectureFactIds = [...new Set(
      input.architectureFactIds
        .map((value) => clean(value))
        .filter(Boolean)
    )].sort();
  }

  if (
    decision === 'not_applicable' &&
    (!architectureFactIds || architectureFactIds.length === 0)
  ) {
    throw new Error(
      'A not_applicable decision requires at least one confirmed supporting architecture fact ID.'
    );
  }

  return {
    controlId,
    decision,
    reason:
      reason ||
      'Explicit local human applicability review',
    architectureFactIds
  };
}
