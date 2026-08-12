export const POST_VERIFY_CONTINUATION_KEY = 'arl_post_verify_continue';
export const POST_VERIFY_CONTINUATION_TTL_MS = 30 * 60 * 1000;

export function buildPostVerifyContinuation({ claimAssessmentId, next, origin, now = Date.now() }) {
  const expiresAt = Number(now) + POST_VERIFY_CONTINUATION_TTL_MS;
  if (typeof claimAssessmentId === 'string' && claimAssessmentId.trim()) {
    return { kind: 'assessment', assessmentId: claimAssessmentId.trim(), expiresAt };
  }
  try {
    const candidate = new URL(next || '/dashboard.html', origin);
    if (candidate.origin !== origin || candidate.pathname !== '/pricing.html') return null;
    return { kind: 'path', path: `/pricing.html${candidate.hash || ''}`, expiresAt };
  } catch {
    return null;
  }
}

export function parsePostVerifyContinuation(raw, { origin, now = Date.now() }) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !Number.isFinite(Number(value.expiresAt)) || Number(value.expiresAt) < Number(now)) return null;
    if (value.kind === 'assessment' && typeof value.assessmentId === 'string' && value.assessmentId.trim()) {
      return { kind: 'assessment', assessmentId: value.assessmentId.trim() };
    }
    if (value.kind === 'path' && typeof value.path === 'string' && value.path.startsWith('/pricing.html') && !value.path.startsWith('//')) {
      const candidate = new URL(value.path, origin);
      if (candidate.origin !== origin || candidate.pathname !== '/pricing.html') return null;
      return { kind: 'path', path: `/pricing.html${candidate.hash || ''}` };
    }
  } catch {
    return null;
  }
  return null;
}

export function targetForContinuation(continuation, assessments = []) {
  if (!continuation) return null;
  if (continuation.kind === 'path') return continuation.path;
  if (continuation.kind !== 'assessment') return null;
  const assessment = assessments.find((item) => item?.id === continuation.assessmentId);
  if (!assessment?.access_token) return '/dashboard.html';
  return `/result.html?id=${encodeURIComponent(assessment.id)}&token=${encodeURIComponent(assessment.access_token)}`;
}
