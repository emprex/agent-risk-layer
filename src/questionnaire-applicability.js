import { questionnaire } from './risk-engine.js';

const NOT_APPLICABLE_TAG = 'not-applicable';

function addNotApplicableOption(questionId, value, label) {
    const question = questionnaire.find((item) => item.id === questionId);
    if (!question || question.options.some((item) => item.value === value))
        return;
    const option = { value, label, points: 0, tags: [NOT_APPLICABLE_TAG] };
    const unknownIndex = question.options.findIndex((item) => item.value === 'unknown');
    if (unknownIndex >= 0)
        question.options.splice(unknownIndex, 0, option);
    else
        question.options.push(option);
}

// Model-specific controls must not become false findings or information gaps for
// deterministic/no-model agents. These choices remain declarations until evidence
// supports the claimed architecture, matching every other N/A control state.
addNotApplicableOption('output_validation', 'no-model', 'Not applicable — this agent does not use a model');
addNotApplicableOption('data_minimisation', 'no-model', 'Not applicable — this agent does not use a model');
addNotApplicableOption('cost_limits', 'not-applicable', 'Not applicable — no model, autonomous retry/recursion loop or metered agent spend');

export const noModelApplicabilityQuestionIds = Object.freeze([
    'output_validation',
    'data_minimisation',
    'cost_limits',
]);
