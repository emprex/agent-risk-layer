import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/config.js';
import { evaluateAssessment, questionnaire } from '../src/risk-engine.js';

function safeAnswers(evidence = 'customer_assertion') {
    return Object.fromEntries(questionnaire.map((question) => [question.id, {
        value: question.options.find((option) => !option.tags.includes('uncertainty'))?.value,
        evidence,
    }]));
}

test('no-model N/A choices are available for model-specific controls', () => {
    const output = questionnaire.find((question) => question.id === 'output_validation');
    const minimisation = questionnaire.find((question) => question.id === 'data_minimisation');
    const resource = questionnaire.find((question) => question.id === 'cost_limits');

    assert.equal(output.options.find((option) => option.value === 'no-model')?.label, 'Not applicable — this agent does not use a model');
    assert.equal(minimisation.options.find((option) => option.value === 'no-model')?.label, 'Not applicable — this agent does not use a model');
    assert.match(resource.options.find((option) => option.value === 'not-applicable')?.label || '', /no model, autonomous retry\/recursion loop or metered agent spend/i);
    assert.ok(output.options.find((option) => option.value === 'no-model')?.tags.includes('not-applicable'));
    assert.ok(minimisation.options.find((option) => option.value === 'no-model')?.tags.includes('not-applicable'));
    assert.ok(resource.options.find((option) => option.value === 'not-applicable')?.tags.includes('not-applicable'));
});

test('no-model N/A answers are known applicability declarations, not findings or information gaps', () => {
    const answers = safeAnswers();
    answers.output_validation = { value: 'no-model', evidence: 'customer_assertion' };
    answers.data_minimisation = { value: 'no-model', evidence: 'customer_assertion' };
    answers.cost_limits = { value: 'not-applicable', evidence: 'customer_assertion' };

    const result = evaluateAssessment(answers, { agentType: 'Customer support agent' });
    const affected = result.controls.filter((control) => [
        'How are model outputs validated before use?',
        'Is sensitive data minimised before model processing?',
        'Are token, retry, recursion and spend limits enforced outside the model?',
    ].includes(control.name));

    assert.equal(result.unresolvedItems.length, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(affected.length, 3);
    assert.ok(affected.every((control) => control.status === 'not-applicable-declared'));
    assert.ok(affected.every((control) => control.applicability === 'not-applicable-claimed'));
    assert.equal(result.assessmentCompleteness, 100);
});
