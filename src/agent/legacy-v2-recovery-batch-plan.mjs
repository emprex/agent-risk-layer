// Read-only planning: never treats a diagnostic lane as authorisation.
export function selectNextLegacyV2RecoveryBatch(review, limit = 20) {
  if (!review || !Array.isArray(review.lineageExceptions) ||
      review.summary?.lineageExceptions !== review.lineageExceptions.length ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Complete bounded active lineage inventory required.');
  }
  const eligible = [...new Set(review.lineageExceptions.filter(item =>
    item.lineageStatus === 'structured_observation_missing' &&
    item.diagnosticLane === 'bounded_recollection_candidate_manual_authorisation_required' &&
    /^ARL-KB-\\d{3}$/.test(item.controlId || '')
  ).map(item => item.controlId))].sort();
  return {eligibleControls:eligible.length,selectedControls:eligible.slice(0,limit)};
}
