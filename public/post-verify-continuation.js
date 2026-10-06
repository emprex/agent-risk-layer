export const POST_VERIFY_CONTINUATION_KEY = 'arl_post_verify_continue';
export const POST_VERIFY_CONTINUATION_TTL_MS = 30 * 60 * 1000;

export function buildPostVerifyContinuation({
  claimAssessmentId,
  now = Date.now()
}) {
  if (
    typeof claimAssessmentId !== 'string' ||
    !claimAssessmentId.trim()
  ) return null;

  return {
    kind: 'assessment',
    assessmentId: claimAssessmentId.trim(),
    expiresAt:
      Number(now) + POST_VERIFY_CONTINUATION_TTL_MS
  };
}

export function parsePostVerifyContinuation(
  raw,
  { now = Date.now() } = {}
) {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      value.kind !== 'assessment' ||
      typeof value.assessmentId !== 'string' ||
      !value.assessmentId.trim() ||
      !Number.isFinite(Number(value.expiresAt)) ||
      Number(value.expiresAt) < Number(now)
    ) return null;

    return {
      kind: 'assessment',
      assessmentId: value.assessmentId.trim()
    };
  } catch {
    return null;
  }
}

export function targetForContinuation(
  continuation,
  assessments = []
) {
  if (
    !continuation ||
    continuation.kind !== 'assessment'
  ) return null;

  const assessment = assessments.find(
    (item) => item?.id === continuation.assessmentId
  );

  if (!assessment?.access_token)
    return '/dashboard.html';

  return `/result.html?id=${encodeURIComponent(
    assessment.id
  )}&token=${encodeURIComponent(
    assessment.access_token
  )}`;
}
