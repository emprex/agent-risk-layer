import { config } from '../config.js';
import { db, id, insertEvent, nowIso } from '../db.js';
import { evaluateAssessment, questionnaire } from '../risk-engine.js';

export const ASSESSMENT_BOOTSTRAP_SCHEMA =
  'arl.agent.assessment-bootstrap.v1';

function bootstrapError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function unknownAssessmentAnswers() {
  const answers = {};
  for (const question of questionnaire) {
    const supportsUnknown = question.options?.some(
      (option) => option.value === 'unknown'
    );
    if (!supportsUnknown) {
      throw bootstrapError(
        'ASSESSMENT_BOOTSTRAP_UNKNOWN_UNSUPPORTED',
        `Assessment question ${question.id} has no explicit unknown option.`
      );
    }
    answers[question.id] = 'unknown';
  }
  return answers;
}

export async function createUnknownAssessment({
  userId,
  name
}) {
  const answers = unknownAssessmentAnswers();
  const agentType = 'AI agent';
  const result = evaluateAssessment(answers, {
    agentType
  });
  const assessmentId = id('asm_');
  const accessToken = id('access_');
  const shareToken = id('share_');
  const created = nowIso();

  await db.prepare(`
    INSERT INTO assessments
      (id, user_id, name, agent_type, answers_json, score, risk_band,
       result_json, paid_tier, access_token, share_token, public_enabled,
       scoring_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 0, ?, ?, ?)
  `).run(
    assessmentId,
    userId,
    name,
    agentType,
    JSON.stringify(answers),
    result.score,
    result.riskBand,
    JSON.stringify(result),
    accessToken,
    shareToken,
    config.scoringVersion,
    created,
    created
  );

  await insertEvent(
    'agent_assessment_bootstrapped',
    userId,
    {
      assessmentId,
      answerMode: 'explicit_unknown_only',
      questionCount: questionnaire.length
    }
  );

  return {
    id: assessmentId,
    answers,
    result
  };
}
