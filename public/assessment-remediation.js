const normalise = (value) => String(value || '').trim().toLowerCase();

export function assessmentRemediationHref({ assessmentId, token = '', isOwner = false }) {
  const params = new URLSearchParams({ assessment: assessmentId });
  if (token && !isOwner) params.set('token', token);
  return `/control-plane.html?${params.toString()}#remediation`;
}

export function assessmentProjects(overview = {}) {
  const runtime = (overview.projects || []).filter((item) => item.projectKind !== 'assessment_case');
  const cases = overview.assessmentCases?.projects || [];
  return [...runtime, ...cases];
}

export function matchingAssessmentProject(overview, assessment) {
  const name = normalise(assessment?.name);
  if (!name) return null;
  return assessmentProjects(overview).find((item) => normalise(item.name) === name) || null;
}

export function assessmentEnvironment(assessment = {}) {
  const text = normalise(`${assessment.name || ''} ${assessment.result?.systemDescription || ''}`);
  if (/production|live\b/.test(text)) return 'production';
  if (/staging|pre-production|preproduction/.test(text)) return 'staging';
  if (/\btest|testing|qa\b/.test(text)) return 'test';
  return 'development';
}

export function remediationFindingKey(assessmentId, finding = {}) {
  const id = String(finding.id || finding.title || 'finding').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 70);
  return `assessment:${assessmentId}:${id}`.slice(0, 160);
}

export function linkedAssessmentRemediations(project, assessmentId) {
  return (project?.remediations || []).filter((item) => item.assessment_id === assessmentId);
}
