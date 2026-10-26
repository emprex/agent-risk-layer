// Pure evidence trust policy. No database access or security-authority writes.
// Readiness and operator review must apply the exact same red-team semantics.
export const REDTEAM_VERIFICATION_SCOPE = 'integrity_verified_customer_operated';
export const REDTEAM_INITIAL_VERIFICATION_SCOPE =
  'integrity_verified_customer_operated_initial';
export const REDTEAM_TRUST_BOUNDARY = 'Integrity-verified redacted outcomes from a customer-operated local/test/staging run. AgentRiskLayer did not independently operate the target or retain raw transcripts.';

function parse(value, fallback) {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
}

function time(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

export function redTeamTrustFromRow(row) {
  if (!row?.redteam_run_id) return null;
  const descriptor = parse(row.descriptor_json, {});

  if (
    descriptor.verificationScope ===
      REDTEAM_INITIAL_VERIFICATION_SCOPE
  ) {
    if (
      !row.redteam_case_id ||
      descriptor.redteamRunId !== row.redteam_run_id ||
      descriptor.redteamCaseId !== row.redteam_case_id
    ) {
      return {
        state: 'unverified',
        reason:
          'Initial Red-team evidence provenance IDs do not match the integrity-bound evidence descriptor.'
      };
    }

    if (Number(row.redteam_signature_valid) !== 1) {
      return {
        state: 'unverified',
        reason:
          'The linked initial Red-team run no longer has a valid uploaded signature.'
      };
    }

    if (
      !row.redteam_bundle_digest ||
      descriptor.sourceDigest !== row.redteam_bundle_digest
    ) {
      return {
        state: 'unverified',
        reason:
          'The linked initial Red-team bundle digest does not match the evidence source digest.'
      };
    }

    if (
      row.redteam_retention_expires_at &&
      time(row.redteam_retention_expires_at) <= Date.now()
    ) {
      return {
        state: 'stale',
        reason:
          'The linked initial Red-team source is outside its retained evidence window.'
      };
    }

    return {
      state: 'verified',
      reason: null,
      verificationScope:
        REDTEAM_INITIAL_VERIFICATION_SCOPE,
      trustBoundary:
        descriptor.trustBoundary ||
        REDTEAM_TRUST_BOUNDARY,
      redteamRunId: row.redteam_run_id,
      redteamBaselineRunId: null,
      redteamCaseId: row.redteam_case_id
    };
  }

  if (descriptor.verificationScope !== REDTEAM_VERIFICATION_SCOPE) {
    return { state: 'unverified', reason: 'Red-team evidence is missing the required integrity-verification scope.' };
  }
  if (!row.redteam_baseline_run_id || !row.redteam_case_id
      || descriptor.redteamRunId !== row.redteam_run_id
      || descriptor.redteamBaselineRunId !== row.redteam_baseline_run_id
      || descriptor.redteamCaseId !== row.redteam_case_id) {
    return { state: 'unverified', reason: 'Red-team evidence provenance IDs do not match the integrity-bound evidence descriptor.' };
  }
  if (Number(row.redteam_signature_valid) !== 1) {
    return { state: 'unverified', reason: 'The linked red-team retest run no longer has a valid uploaded signature.' };
  }
  if (!row.redteam_bundle_digest || descriptor.sourceDigest !== row.redteam_bundle_digest) {
    return { state: 'unverified', reason: 'The linked red-team retest bundle digest does not match the evidence source digest.' };
  }
  if (Number(row.redteam_baseline_signature_valid) !== 1) {
    return { state: 'unverified', reason: 'The linked red-team failed baseline no longer has a valid uploaded signature.' };
  }
  if (!row.redteam_baseline_bundle_digest || descriptor.baselineBundleDigest !== row.redteam_baseline_bundle_digest) {
    return { state: 'unverified', reason: 'The linked red-team failed baseline digest no longer matches the integrity-bound evidence descriptor.' };
  }
  if ((row.redteam_retention_expires_at && time(row.redteam_retention_expires_at) <= Date.now())
      || (row.redteam_baseline_retention_expires_at && time(row.redteam_baseline_retention_expires_at) <= Date.now())) {
    return { state: 'stale', reason: 'A linked red-team source is outside its retained evidence window.' };
  }
  return {
    state: 'verified',
    reason: null,
    verificationScope: REDTEAM_VERIFICATION_SCOPE,
    trustBoundary: descriptor.trustBoundary || REDTEAM_TRUST_BOUNDARY,
    redteamRunId: row.redteam_run_id,
    redteamBaselineRunId: row.redteam_baseline_run_id,
    redteamCaseId: row.redteam_case_id,
  };
}
