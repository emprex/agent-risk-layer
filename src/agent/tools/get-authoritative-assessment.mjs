export async function getAuthoritativeAssessment({
  assessmentId,
  userId
} = {}) {
  if (!assessmentId || !userId) {
    return {
      type: 'authoritative_assessment',
      available: false,
      reason: 'assessment_identity_required',
      assessmentId: assessmentId || null
    };
  }

  const persistenceAvailable =
    Boolean(process.env.DATABASE_URL) ||
    (
      process.env.NODE_ENV === 'test' &&
      !process.env.DATABASE_URL
    );

  if (!persistenceAvailable) {
    return {
      type: 'authoritative_assessment',
      available: false,
      reason: 'authoritative_persistence_unavailable',
      assessmentId
    };
  }

  const { db } = await import('../../db.js');

  const row = await db.prepare(`
    SELECT
      id,
      user_id,
      name,
      agent_type,
      answers_json,
      score,
      risk_band,
      result_json,
      scoring_version,
      created_at,
      updated_at
    FROM assessments
    WHERE id = ?
      AND user_id = ?
  `).get(
    String(assessmentId),
    String(userId)
  );

  if (!row) {
    return {
      type: 'authoritative_assessment',
      available: false,
      reason: 'assessment_not_found_or_not_owned',
      assessmentId
    };
  }

  let result = {};

  try {
    result = JSON.parse(row.result_json || '{}');
  } catch {
    return {
      type: 'authoritative_assessment',
      available: false,
      reason: 'assessment_result_invalid',
      assessmentId
    };
  }

  let answers = {};

  try {
    answers = JSON.parse(row.answers_json || '{}');
  } catch {
    answers = {};
  }

  return {
    type: 'authoritative_assessment',
    available: true,

    assessmentId: row.id,
    userId: row.user_id,

    name: row.name || null,
    agentType: row.agent_type || null,

    score:
      row.score == null
        ? null
        : Number(row.score),

    riskBand: row.risk_band || null,

    scoringVersion:
      row.scoring_version || null,

    answers,
    result,

    createdAt:
      row.created_at || null,

    updatedAt:
      row.updated_at || null
  };
}
