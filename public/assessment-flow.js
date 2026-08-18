function answerValue(answers, id) {
  const raw = answers instanceof Map ? answers.get(id) : answers?.[id];
  return typeof raw === 'string' ? raw : raw?.value;
}

const deterministicRules = Object.freeze([
  {
    questionId: 'tool_authorization',
    value: 'not-applicable',
    applies: (answers) => answerValue(answers, 'tool_scope') === 'none',
    reason: 'Skipped because this assessment says the agent has no executable tools.',
  },
  {
    questionId: 'human_approval',
    value: 'not-applicable',
    applies: (answers) => answerValue(answers, 'transactions') === 'none',
    reason: 'Skipped because this assessment says the agent cannot perform high-impact actions.',
  },
]);

export function deriveDeterministicApplicability(questionnaire = [], answers = new Map()) {
  const byId = new Map(questionnaire.map((question) => [question.id, question]));
  return deterministicRules.flatMap((rule) => {
    if (!rule.applies(answers)) return [];
    const question = byId.get(rule.questionId);
    if (!question?.options?.some((option) => option.value === rule.value)) return [];
    return [{
      questionId: rule.questionId,
      answer: { value: rule.value, evidence: 'none' },
      reason: rule.reason,
    }];
  });
}

export function buildAdaptiveQuestionFlow(questionnaire = [], answers = new Map()) {
  const derived = deriveDeterministicApplicability(questionnaire, answers);
  const skipped = new Set(derived.map((item) => item.questionId));
  return {
    questions: questionnaire.filter((question) => !skipped.has(question.id)),
    derived,
  };
}
