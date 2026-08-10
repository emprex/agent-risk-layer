export function buildRevisionQuestionFlow(questionnaire, answers, reviewAllPrevious = false) {
  const questions = Array.isArray(questionnaire) ? questionnaire : [];
  if (reviewAllPrevious) return [...questions];

  const unresolved = questions.filter((question) => {
    const answer = answers instanceof Map ? answers.get(question.id) : undefined;
    return !answer || answer.value === 'unknown';
  });

  // If everything was answered previously, still expose the full questionnaire so
  // an updated assessment can correct an earlier declaration without mutating history.
  return unresolved.length ? unresolved : [...questions];
}
