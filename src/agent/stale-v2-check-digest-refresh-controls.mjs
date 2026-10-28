// Select only digest-only stale v2 collectors. This selector never changes
// applicability, test results or evidence trust, and never widens the bulk limit.
const CONTROL_ID = /^ARL-KB-\d{3}$/;
const MAX_BULK_CONTROLS = 20;

export function selectStaleV2CheckDigestRefreshControls(
  review,
  { controlId = null } = {}
) {
  if (!Array.isArray(review?.lineageExceptions)) {
    throw new Error('Current authoritative source-lineage review is required.');
  }
  if (controlId !== null && !CONTROL_ID.test(controlId)) {
    throw new Error('Scoped stale digest refresh requires a canonical ARL-KB-### control ID.');
  }

  const eligible = [...new Set(
    review.lineageExceptions
      .filter((item) =>
        CONTROL_ID.test(item?.controlId || '') &&
        item.sourceType === 'arl_frozen_source_evidence_collection_v2' &&
        item.lineageStatus === 'source_test_or_check_lineage_mismatch' &&
        Array.isArray(item.lineageMismatchReasons) &&
        item.lineageMismatchReasons.length === 1 &&
        item.lineageMismatchReasons[0] === 'check_digest_mismatch'
      )
      .map((item) => item.controlId)
  )].sort();

  if (controlId !== null) {
    if (!eligible.includes(controlId)) {
      throw new Error(
        `Scoped stale digest refresh refused: ${controlId} has no eligible digest-only v2 source lineage. No evidence was written.`
      );
    }
    return [controlId];
  }

  if (eligible.length > MAX_BULK_CONTROLS) {
    throw new Error(
      'Stale digest refresh exceeds bounded 20-control limit. ' +
      'Use Refresh stale v2 check digests ARL-KB-### to select one eligible control.'
    );
  }
  return eligible;
}
