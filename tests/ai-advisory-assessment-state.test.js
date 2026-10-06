import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdvisoryContext,
  isAssessmentStateExplanationRequest
} from '../src/agent/ai/advisory-context.mjs';
import {
  buildGroundedFacts,
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
      assessment: {
        stage: 'control_applicability_required',
        known: {
          frozenTargetVerified: true,
          assessmentContextAvailable: true,
          authoritativeAssessmentAvailable: true,
          targetContextBound: true,
          assessmentContextBound: true,
          evidencePlanAvailable: true,
          controlIntelligenceAvailable: true,
          internalSecretFlag: true
        },
        remainsUnproven: [
          'Control applicability still requires authoritative human resolution.'
        ],
        requiredAction: {
          actor: 'user',
          label: 'review the current guided applicability question',
          requiresUserInput: true,
          internalCommand: 'approve-everything'
        },
        readiness: {
          available: false,
          decision: null,
          finalDeploymentDecisionMade: false,
          secretReadinessField: 'must-not-leak'
        }
      }
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
    context.requiredAction.label,
    'review the current guided applicability question'
  );
  assert.equal(
    context.known.frozenTargetVerified,
    true
  );
  assert.deepEqual(
    context.remainsUnproven,
    [
      'Control applicability still requires authoritative human resolution.'
    ]
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
  assert.equal(
    serialized.includes('approve-everything'),
    false
  );
  assert.equal(
    serialized.includes('internalSecretFlag'),
    false
  );
  assert.equal(
    serialized.includes('secretReadinessField'),
    false
  );
});

test('current-state AI request detection is explicit and read-only in scope', () => {
  assert.equal(
    isAssessmentStateExplanationRequest(
      'Explain current assessment state'
    ),
    true
  );
  assert.equal(
    isAssessmentStateExplanationRequest(
      'Explain where we are.'
    ),
    true
  );
  assert.equal(
    isAssessmentStateExplanationRequest(
      'Continue assessment'
    ),
    false
  );
  assert.equal(
    isAssessmentStateExplanationRequest(
      'I authorise the bounded test'
    ),
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


test('Ollama timeout can be configured for slower local models', async () => {
  const previous = process.env.ARL_AI_TIMEOUT_MS;
  process.env.ARL_AI_TIMEOUT_MS = '25';

  try {
    const started = Date.now();
    const result = await askLocalOllama({
      fetchImpl: async (_url, options) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
        return { ok: true, async json() { return {}; } };
      },
      messages: []
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, 'ollama_timeout');
    assert.ok(Date.now() - started < 500);
  } finally {
    if (previous === undefined) {
      delete process.env.ARL_AI_TIMEOUT_MS;
    } else {
      process.env.ARL_AI_TIMEOUT_MS = previous;
    }
  }
});


test('grounded facts contain only projected ARL state and no invented lineage', () => {
  const context = buildAdvisoryContext(authoritativeFixture());
  const facts = buildGroundedFacts(context);
  const rendered = JSON.stringify(facts);

  assert.equal(rendered.includes('lineage'), false);
  assert.equal(rendered.includes('ambiguity'), false);
  assert.equal(rendered.includes('never-send-this'), false);
  assert.ok(
    facts.some((fact) =>
      fact.text.includes('Control applicability still requires authoritative human resolution.')
    )
  );
});

test('AI prompt forbids unsupported causal inference and carries numbered facts', async () => {
  let messages = null;

  await explainAssessmentState(
    authoritativeFixture(),
    {
      ask: async (input) => {
        messages = input.messages;
        return {
          available: true,
          model: 'test-model',
          content: '[F1] Current stage explained.'
        };
      }
    }
  );

  assert.ok(
    messages[0].content.includes(
      'Do not infer causes, hidden state, ambiguity, lineage'
    )
  );
  assert.ok(messages[1].content.includes('[F1]'));
  assert.equal(
    messages[1].content.includes('never-send-this'),
    false
  );
});
