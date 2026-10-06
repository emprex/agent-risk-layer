import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdvisoryContext
} from '../src/agent/ai/advisory-context.mjs';
import {
  explainAssessmentState
} from '../src/agent/ai/assessment-explainer.mjs';
import {
  askLocalOllama
} from '../src/agent/ai/ollama-client.mjs';

function authoritativeFixture() {
  return {
    workflowState: {
      stage: 'control_applicability_required',
      scopedControl: {
        controlId: 'ARL-007',
        title: 'Bounded tool authority',
        secretInternalField: 'must-not-leak'
      },
      evidenceSummary: 'Two observed artefacts are present.',
      limitations: 'No controlled test has run yet.',
      nextAllowedAction: {
        name: 'review_control_applicability',
        actor: 'user',
        requiresUserInput: true,
        controlId: 'ARL-007',
        dangerousInternalCommand: 'approve-everything'
      },
      authoritativeArtifacts: {
        credentials: 'never-send-this'
      },
      deploymentDecision: 'not_authorised'
    },
    conversationResponse: {
      publicSummary: 'Public fallback summary.'
    },
    findingSeverity: 'critical',
    evidenceValidity: true
  };
}

test('advisory context exposes only the bounded allowlist', () => {
  const context =
    buildAdvisoryContext(authoritativeFixture());

  assert.equal(
    context.stage,
    'control_applicability_required'
  );
  assert.equal(context.control.controlId, 'ARL-007');
  assert.equal(
    context.nextAllowedAction.name,
    'review_control_applicability'
  );

  const serialized = JSON.stringify(context);
  assert.equal(
    serialized.includes('never-send-this'),
    false
  );
  assert.equal(
    serialized.includes('approve-everything'),
    false
  );
  assert.equal(
    serialized.includes('findingSeverity'),
    false
  );
  assert.equal(
    serialized.includes('evidenceValidity'),
    false
  );
  assert.equal(
    serialized.includes('deploymentDecision'),
    false
  );
});

test('AI explanation cannot mutate authoritative state', async () => {
  const canonicalData = authoritativeFixture();
  const before = structuredClone(canonicalData);

  const result = await explainAssessmentState(
    canonicalData,
    {
      ask: async () => ({
        available: true,
        model: 'test-model',
        content: 'Advisory explanation only.'
      })
    }
  );

  assert.deepEqual(canonicalData, before);
  assert.equal(result.available, true);
  assert.equal(result.advisoryOnly, true);
  assert.equal(
    result.explanation,
    'Advisory explanation only.'
  );
});

test('AI failure degrades safely without changing ARL state', async () => {
  const canonicalData = authoritativeFixture();
  const before = structuredClone(canonicalData);

  const result = await explainAssessmentState(
    canonicalData,
    {
      ask: async () => ({
        available: false,
        reason: 'ollama_unavailable'
      })
    }
  );

  assert.deepEqual(canonicalData, before);
  assert.equal(result.available, false);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.reason, 'ollama_unavailable');
});


test('Ollama client uses the bounded local chat endpoint', async () => {
  let observedUrl = null;
  let observedBody = null;

  const result = await askLocalOllama({
    baseUrl: 'http://127.0.0.1:11434/',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      observedUrl = url;
      observedBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: 'Local advisory response.'
            }
          };
        }
      };
    },
    messages: [
      {
        role: 'user',
        content: '{"stage":"inspection"}'
      }
    ]
  });

  assert.equal(
    observedUrl,
    'http://127.0.0.1:11434/api/chat'
  );
  assert.deepEqual(observedBody, {
    model: 'test-model',
    stream: false,
    messages: [
      {
        role: 'user',
        content: '{"stage":"inspection"}'
      }
    ]
  });
  assert.equal(result.available, true);
});

test('Ollama HTTP failure is advisory-only unavailability', async () => {
  const result = await askLocalOllama({
    fetchImpl: async () => ({
      ok: false,
      status: 503
    }),
    messages: []
  });

  assert.deepEqual(result, {
    available: false,
    reason: 'ollama_http_503'
  });
});
