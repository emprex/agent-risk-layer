import {
  parseLocalManualEvidencePayload
} from './local-manual-evidence-command.mjs';

const PREFIX = 'Record human evidence batch ';

function clean(value) {
  return String(value ?? '').trim();
}

export function parseLocalHumanEvidenceBatchCommand(request) {
  const text = clean(request);

  if (!text.startsWith(PREFIX)) {
    return null;
  }

  let input;

  try {
    input = JSON.parse(text.slice(PREFIX.length));
  } catch {
    throw new Error(
      'Record human evidence batch requires a valid JSON object.'
    );
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      'Record human evidence batch requires a JSON object.'
    );
  }

  const batchId = clean(input.batchId);

  if (!/^human_evidence_batch_[a-f0-9]{12}$/.test(batchId)) {
    throw new Error(
      'Record human evidence batch requires a valid stable batchId.'
    );
  }

  if (
    !Array.isArray(input.controls) ||
    input.controls.length === 0 ||
    input.controls.length > 108
  ) {
    throw new Error(
      'Record human evidence batch requires between 1 and 108 control evidence entries.'
    );
  }

  const controls =
    input.controls.map((item) =>
      parseLocalManualEvidencePayload(item)
    );

  const ids = controls.map((item) => item.controlId);

  if (new Set(ids).size !== ids.length) {
    throw new Error(
      'Record human evidence batch cannot contain duplicate controlId entries.'
    );
  }

  return {
    batchId,
    controls
  };
}
