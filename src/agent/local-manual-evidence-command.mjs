const PREFIX = 'Record manual evidence ';

const RESULTS = new Set([
  'passed',
  'failed',
  'inconclusive'
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function parseLocalManualEvidencePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      'Record manual evidence requires a JSON object.'
    );
  }

  const controlId = clean(input.controlId).toUpperCase();

  if (!/^ARL-KB-\d{3}$/.test(controlId)) {
    throw new Error(
      'Record manual evidence requires a valid ARL-KB-### controlId.'
    );
  }

  const result = clean(input.result).toLowerCase();

  if (!RESULTS.has(result)) {
    throw new Error(
      'Manual evidence result must be passed, failed, or inconclusive.'
    );
  }

  const observedResult = clean(input.observedResult);

  if (observedResult.length < 10) {
    throw new Error(
      'Manual evidence requires a specific privacy-safe observedResult of at least 10 characters.'
    );
  }

  const sourceReference = clean(input.sourceReference);

  if (sourceReference.length < 3) {
    throw new Error(
      'Manual evidence requires a privacy-safe sourceReference.'
    );
  }

  const evidenceChecklist =
    Array.isArray(input.evidenceChecklist)
      ? input.evidenceChecklist.map((item) => ({
          requirement: clean(item?.requirement),
          evidenceReference: clean(item?.evidenceReference),
          observation: clean(item?.observation),
          satisfied:
            typeof item?.satisfied === 'boolean'
              ? item.satisfied
              : null
        }))
      : [];

  if (
    result !== 'inconclusive' &&
    evidenceChecklist.length === 0
  ) {
    throw new Error(
      'Conclusive manual evidence requires evidenceChecklist entries for every canonical required-evidence item.'
    );
  }

  for (const item of evidenceChecklist) {
    if (
      item.requirement.length < 3 ||
      item.evidenceReference.length < 3 ||
      item.observation.length < 10
    ) {
      throw new Error(
        'Each manual evidence checklist item requires requirement, privacy-safe evidenceReference, and a specific observation of at least 10 characters.'
      );
    }

    if (
      result !== 'inconclusive' &&
      typeof item.satisfied !== 'boolean'
    ) {
      throw new Error(
        'Each conclusive manual evidence checklist item requires a boolean satisfied value.'
      );
    }
  }

  const derivedResult =
    result === 'inconclusive'
      ? 'inconclusive'
      : evidenceChecklist.every((item) => item.satisfied === true)
        ? 'passed'
        : 'failed';

  if (
    result !== 'inconclusive' &&
    result !== derivedResult
  ) {
    throw new Error(
      `Manual evidence result mismatch: canonical checklist deterministically derives ${derivedResult}, not ${result}.`
    );
  }

  return {
    controlId,
    result: derivedResult,
    observedResult,
    sourceReference,
    limitations: clean(input.limitations),
    evidenceChecklist
  };
}

export function parseLocalManualEvidenceCommand(request) {
  const text = clean(request);

  if (!text.startsWith(PREFIX)) {
    return null;
  }

  let input;

  try {
    input = JSON.parse(text.slice(PREFIX.length));
  } catch {
    throw new Error(
      'Record manual evidence requires a valid JSON object.'
    );
  }

  return parseLocalManualEvidencePayload(input);
}
