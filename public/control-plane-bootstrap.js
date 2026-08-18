import { api } from './shared.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
const token = params.get('token') || '';
const verificationReadyKey = assessmentId ? `arl_assessment_verification_ready:${assessmentId}` : '';

function actionableFindings(assessment) {
  return (assessment?.result?.findings || []).filter((item) =>
    item?.status !== 'information-required' && item?.kind !== 'information-required');
}

function assessmentResultHref() {
  const resultParams = new URLSearchParams({ id: assessmentId });
  if (token) resultParams.set('token', token);
  return `/result.html?${resultParams.toString()}#priorityRisks`;
}

function assessmentEvidenceHref() {
  const evidenceParams = new URLSearchParams({ assessment: assessmentId });
  if (token) evidenceParams.set('token', token);
  return `/inspector.html?${evidenceParams.toString()}`;
}

async function startControlPlane() {
  if (!assessmentId) {
    await import('./control-plane.js?v=20260818.1');
    return;
  }

  try {
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const payload = await api(`/api/assessments/${encodeURIComponent(assessmentId)}${tokenQuery}`);
    const assessment = payload?.assessment;
    const concerns = actionableFindings(assessment);

    if (assessment && concerns.length === 0) {
      location.replace(assessmentResultHref());
      return;
    }

    // Assessment answers are concerns, not confirmed findings. The normal
    // customer path must establish observed/reproducible evidence before
    // entering remediation. Evidence can explicitly mark the assessment ready
    // to return to Findings once verification has established a supported
    // failure; until then route to Evidence rather than manufacturing fixes.
    if (assessment && concerns.length > 0 && sessionStorage.getItem(verificationReadyKey) !== 'true') {
      location.replace(assessmentEvidenceHref());
      return;
    }
  } catch {
    // Let the existing control-plane flow handle authentication, access and errors.
  }

  await import('./control-plane.js?v=20260818.1');
}

startControlPlane();
