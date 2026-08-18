import { api } from './shared.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';

function actionableFindings(assessment) {
  return (assessment?.result?.findings || []).filter((item) =>
    item?.status !== 'information-required' && item?.kind !== 'information-required');
}

async function latestObservedFindings() {
  const { inspections = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`);
  const latest = inspections[0];
  if (!latest?.id || Number(latest.summary?.activeFindingsTotal || latest.summary?.findingsTotal || 0) <= 0) return [];
  const { inspection } = await api(`/api/inspections/${encodeURIComponent(latest.id)}`);
  return (inspection?.findings || []).filter((item) => item?.review?.status !== 'false-positive');
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
    // Once the assessment has active observed findings, the gate is lifted and
    // the remediation workspace is allowed to render those evidence-backed items.
    if (assessment && actionableFindings(assessment).length > 0) {
      const observed = await latestObservedFindings();
      if (!observed.length) {
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
