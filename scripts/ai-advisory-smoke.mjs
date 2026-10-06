import {
  explainAssessmentState
} from '../src/agent/ai/assessment-explainer.mjs';

const syntheticCanonicalData = {
  workflowState: {
    stage: 'control_applicability_required',
    scopedControl: {
      controlId: 'ARL-SMOKE-001',
      title: 'Synthetic advisory smoke control'
    },
    evidenceSummary:
      'Synthetic smoke evidence only. No customer or production evidence is present.',
    limitations:
      'This probe validates local AI explanation connectivity only. It does not validate a security control.',
    nextAllowedAction: {
      name: 'review_control_applicability',
      actor: 'user',
      requiresUserInput: true,
      controlId: 'ARL-SMOKE-001'
    }
  },
  conversationResponse: {
    publicSummary:
      'Synthetic local advisory connectivity probe.'
  }
};

console.log('ARL AI ADVISORY SMOKE');
console.log('');
console.log('Purpose: verify local Ollama/Qwen advisory explanation only.');
console.log('No customer repository, PostgreSQL record, finding, evidence decision, or deployment decision is used.');
console.log('');

const result =
  await explainAssessmentState(
    syntheticCanonicalData
  );

if (!result.available) {
  console.error(
    `FAIL: local AI advisory unavailable (${result.reason}).`
  );
  console.error(
    'ARL authoritative assessment capability is unaffected.'
  );
  process.exit(2);
}

console.log(
  `Model: ${result.model || 'unknown'}`
);
console.log('');
console.log('Allowlisted context sent to the model:');
console.log(
  JSON.stringify(result.context, null, 2)
);
console.log('');
console.log('Advisory explanation:');
console.log(result.explanation);
console.log('');
console.log(
  'PASS: local AI advisory responded. This output is non-authoritative and made no ARL security decision.'
);
