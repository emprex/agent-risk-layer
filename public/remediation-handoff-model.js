import { assessmentEnvironment, assessmentProjects } from './assessment-remediation.js';

const normalise = (value) => String(value || '').trim().toLowerCase();

export function exactAssessmentProject(overview = {}, assessment = {}) {
  const name = normalise(assessment?.name);
  const environment = normalise(assessmentEnvironment(assessment));
  if (!name || !environment) return null;
  return assessmentProjects(overview).find((item) =>
    normalise(item.name) === name && normalise(item.environment || 'development') === environment) || null;
}

export function assessmentConcernCopy() {
  return {
    label: 'Assessment concern to verify',
    explanation: 'This concern comes from assessment answers. It is declared context, not a verified finding, until observed or reproducible evidence supports it.',
  };
}
