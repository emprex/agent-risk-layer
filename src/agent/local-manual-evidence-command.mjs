const PREFIX = 'Record manual evidence ';

const RESULTS = new Set([
  'passed',
  'failed',
  'inconclusive'
]);

function clean(value) {
  return String(value ?? '').trim();
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

  return {
    controlId,
    result,
    observedResult,
    sourceReference,
    limitations: clean(input.limitations)
  };
}
