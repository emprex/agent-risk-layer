import crypto from 'node:crypto';

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'verified',
  'controlSatisfied',
  'control_satisfied',
  'certified',
  'accredited',
  'ready',
  'deploymentApproved',
  'findingClosed',
  'severity'
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertNoAuthorityClaims(input) {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) {
      throw new Error(`Evidence candidate input must not set authoritative field: ${field}`);
    }
  }
}

export function buildEvidenceCandidate(input = {}) {
  assertNoAuthorityClaims(input);

  const sourceType = clean(input.sourceType);
  const sourceLocator = clean(input.sourceLocator);
  const contentDigest = clean(input.contentDigest).toLowerCase();
  const collectedAt = clean(input.collectedAt);
  const observedFacts = uniqueStrings(input.observedFacts);
  const proposedControlIds = uniqueStrings(input.proposedControlIds);
  const mappingRationale = clean(input.mappingRationale);
  const limitations = clean(input.limitations);

  if (!sourceType) throw new Error('sourceType is required');
  if (!sourceLocator) throw new Error('sourceLocator is required');
  if (!/^[a-f0-9]{64}$/.test(contentDigest)) {
    throw new Error('contentDigest must be a lowercase SHA-256 hex digest');
  }
  if (!collectedAt || Number.isNaN(Date.parse(collectedAt))) {
    throw new Error('collectedAt must be an ISO-compatible timestamp');
  }
  if (!observedFacts.length) throw new Error('observedFacts must contain at least one fact');
  if (!proposedControlIds.length) throw new Error('proposedControlIds must contain at least one control id');
  if (!mappingRationale) throw new Error('mappingRationale is required');
  if (!limitations) throw new Error('limitations is required');

  const provenance = {
    sourceType,
    sourceLocator,
    collectedAt: new Date(collectedAt).toISOString(),
    contentDigest
  };

  const candidateCore = {
    provenance,
    observedFacts,
    proposedControlIds,
    mappingRationale,
    limitations
  };

  const candidateDigest = sha256(stableJson(candidateCore));

  return Object.freeze({
    id: `EV-CAND-${candidateDigest.slice(0, 16).toUpperCase()}`,
    candidateDigest,
    ...candidateCore,
    reviewStatus: 'pending_human_review',
    authority: 'human_required',
    authorityLimitations: Object.freeze({
      evidenceValidity: 'not_decided',
      controlApplicability: 'not_decided',
      controlSatisfaction: 'not_decided',
      readiness: 'not_decided',
      certification: 'not_decided'
    })
  });
}

export function recordHumanEvidenceReview(candidate, decision = {}) {
  if (!candidate || candidate.authority !== 'human_required' || !candidate.candidateDigest) {
    throw new Error('A valid evidence candidate is required');
  }

  const outcome = clean(decision.outcome);
  const reviewerId = clean(decision.reviewerId);
  const reason = clean(decision.reason);
  const reviewedAt = clean(decision.reviewedAt);

  if (!['accepted', 'rejected', 'needs_context'].includes(outcome)) {
    throw new Error('outcome must be accepted, rejected, or needs_context');
  }
  if (!reviewerId) throw new Error('reviewerId is required');
  if (!reason) throw new Error('reason is required');
  if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error('reviewedAt must be an ISO-compatible timestamp');
  }

  const reviewCore = {
    candidateId: candidate.id,
    candidateDigest: candidate.candidateDigest,
    outcome,
    reviewerId,
    reason,
    reviewedAt: new Date(reviewedAt).toISOString()
  };

  const reviewDigest = sha256(stableJson(reviewCore));

  return Object.freeze({
    ...reviewCore,
    reviewDigest,
    meaning: outcome === 'accepted'
      ? 'The human reviewer accepted this candidate as usable evidence for its stated purpose. This does not decide control satisfaction.'
      : outcome === 'rejected'
        ? 'The human reviewer rejected this candidate as usable evidence for its stated purpose.'
        : 'The human reviewer requires additional context before deciding whether this candidate is usable evidence.',
    controlSatisfaction: 'not_decided'
  });
}

export function summarizeControlEvidence({ controlIds = [], candidates = [], reviews = [] } = {}) {
  const controls = uniqueStrings(controlIds);
  const reviewByCandidate = new Map();

  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (!review?.candidateId || !review?.candidateDigest) continue;
    reviewByCandidate.set(review.candidateId, review);
  }

  return controls.map((controlId) => {
    const mapped = (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => candidate?.proposedControlIds?.includes(controlId));

    const states = mapped.map((candidate) => {
      const review = reviewByCandidate.get(candidate.id);
      if (!review || review.candidateDigest !== candidate.candidateDigest) {
        return 'pending_human_review';
      }
      return review.outcome;
    });

    let evidenceStatus = 'no_candidate_evidence';
    if (states.includes('accepted')) evidenceStatus = 'accepted_evidence_exists';
    else if (states.includes('needs_context')) evidenceStatus = 'needs_context';
    else if (states.includes('pending_human_review')) evidenceStatus = 'pending_human_review';
    else if (states.includes('rejected')) evidenceStatus = 'evidence_rejected';

    return Object.freeze({
      controlId,
      candidateCount: mapped.length,
      evidenceStatus,
      controlSatisfaction: 'not_decided',
      requiresHumanDecision: true
    });
  });
}
