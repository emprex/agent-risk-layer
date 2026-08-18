import { api } from './shared.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';

function actionableFindings(assessment) {
  return (assessment?.result?.findings || []).filter((item) =>
    item?.status !== 'information-required' && item?.kind !== 'information-required');
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

    // Assessment answers are concerns, not confirmed findings. Do not enter
    // remediation from this handoff until observed or reproducible evidence
    // has established a real failure. The evidence workspace is the next step.
    if (assessment && actionableFindings(assessment).length > 0) {
      const evidenceParams = new URLSearchParams({ assessment: assessmentId });
      if (token) evidenceParams.set('token', token);
      location.replace(`/inspector.html?${evidenceParams.toString()}`);
      return;
    }
  } catch {
    // Let the existing control-plane flow handle authentication, access and errors.
  }

  await import('./control-plane.js?v=20260814.6');
}

startControlPlane();
