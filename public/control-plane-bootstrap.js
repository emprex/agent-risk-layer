import { api } from './shared.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';

function actionableFindings(assessment) {
  return (assessment?.result?.findings || []).filter((item) =>
    item?.status !== 'information-required' && item?.kind !== 'information-required');
}

function resolvedFindingCount(value) {
  if (Array.isArray(value)) return value.length;
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function latestObservedState() {
  const { inspections = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`);
  const latest = inspections[0];
  if (!latest?.id) return { activeFindings: [], hasResolvedRetest: false };

  const { inspection } = await api(`/api/inspections/${encodeURIComponent(latest.id)}`);
  const activeFindings = (inspection?.findings || []).filter((item) => item?.review?.status !== 'false-positive');
  const delta = inspection?.delta || latest?.delta || {};
  const hasResolvedRetest = resolvedFindingCount(delta.resolvedFindings) > 0
    || resolvedFindingCount(delta.summary?.resolved) > 0
    || resolvedFindingCount(latest?.delta?.resolvedFindings) > 0;

  return { activeFindings, hasResolvedRetest };
}

async function startControlPlane() {
  if (!assessmentId) {
    await import('./control-plane.js?v=20260814.6');
    return;
  }

  try {
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const payload = await api(`/api/assessments/${encodeURIComponent(assessmentId)}${tokenQuery}`);
    const assessment = payload?.assessment;

    if (assessment && actionableFindings(assessment).length === 0) {
      const resultParams = new URLSearchParams({ id: assessmentId });
      if (token) resultParams.set('token', token);
      location.replace(`/result.html?${resultParams.toString()}#priorityRisks`);
      return;
    }

    // Assessment answers are concerns, not confirmed findings. Before observed
    // evidence exists, Findings correctly sends the customer to Evidence.
    // Once observed findings exist, or a latest comparable Inspector retest has
    // resolved a previously observed finding, Findings must remain available so
    // the customer can review and record closure instead of being bounced back
    // to Evidence after a successful retest.
    if (assessment && actionableFindings(assessment).length > 0) {
      const observed = await latestObservedState();
      if (!observed.activeFindings.length && !observed.hasResolvedRetest) {
        const evidenceParams = new URLSearchParams({ assessment: assessmentId });
        if (token) evidenceParams.set('token', token);
        location.replace(`/inspector.html?${evidenceParams.toString()}`);
        return;
      }
    }
  } catch {
    // Let the existing control-plane flow handle authentication, access and errors.
  }

  await import('./control-plane.js?v=20260814.6');
}

startControlPlane();
