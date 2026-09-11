import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authoriseHostedBoundedRoe
} from '../src/agent/hosted-bounded-roe-api.mjs';

const operator = {
  id: 'usr_operator',
  email: 'operator@example.test',
  emailVerified: true
};

const body = {
  repositoryIdentity: {
    provider: 'github',
    owner: 'peakmojo',
    repository: 'agentic-mcp-client'
  },
  frozenInspection: {
    target: {
      revision: 'd73aa9021f86ac1e256a2ca8e2e1679ef663fe32'
    }
  },
  endpointOrigin: 'http://127.0.0.1:8787',
  authorityBasis: 'owner',
  authorisedRole: 'Founder / Owner',
  confirmation: 'I AUTHORISE CONTROLLED TESTING'
};

function dependencies({
  workflowState = {
    stage: 'bounded_test_required',
    nextAllowedAction: {
      name: 'authorise_and_run_bounded_test',
      actor: 'user',
      requiresUserInput: true
    }
  },
  authorisations = [],
  createAuthorisationImpl
} = {}) {
  return {
    resolveOperatorContextImpl: async () => ({
      body: {
        operatorContext: {
          repository: {
            display: 'github.com/peakmojo/agentic-mcp-client'
          }
        }
      },
      internal: {
        userId: 'usr_operator',
        projectId: 'prj_target',
        assessmentId: 'asm_target'
      }
    }),
    getDeclaredContextImpl: async () => ({ confirmed: true }),
    resolvePreparationImpl: async () => ({ internal: {} }),
    buildConversationImpl: async () => ({
      internal: { workflowState }
    }),
    listAuthorisationsImpl: async () => structuredClone(authorisations),
    createAuthorisationImpl:
      createAuthorisationImpl ||
      (async ({ input }) => ({
        id: 'roe_created',
        status: 'active',
        ...input
      }))
  };
}

test('hosted bounded RoE is created only at the authoritative user gate with fixed local safety limits', async () => {
  let captured = null;
  const result = await authoriseHostedBoundedRoe({
    operator,
    body,
    now: () => Date.parse('2026-09-11T08:00:00.000Z'),
    ...dependencies({
      createAuthorisationImpl: async (request) => {
        captured = structuredClone(request);
        return {
          id: 'roe_created',
          status: 'active',
          environment: request.input.environment,
          endpointOrigin: request.input.endpointOrigin,
          syntheticDataOnly: request.input.syntheticDataOnly,
          dryRunToolsOnly: request.input.dryRunToolsOnly,
          windowStart: request.input.windowStart,
          windowEnd: request.input.windowEnd
        };
      }
    })
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.authorisation.id, 'roe_created');
  assert.equal(result.body.securityStateChanged, true);
  assert.equal(result.body.deploymentDecisionWritten, false);

  assert.equal(captured.userId, 'usr_operator');
  assert.equal(captured.assessmentId, 'asm_target');
  assert.equal(captured.input.environment, 'local');
  assert.equal(captured.input.endpointOrigin, 'http://127.0.0.1:8787');
  assert.equal(captured.input.authorityBasis, 'owner');
  assert.equal(captured.input.authorisedBy, operator.email);
  assert.equal(captured.input.authorisedRole, 'Founder / Owner');
  assert.equal(captured.input.emergencyContact, operator.email);
  assert.equal(captured.input.syntheticDataOnly, true);
  assert.equal(captured.input.dryRunToolsOnly, true);
  assert.equal(captured.input.noProductionEffects, true);
  assert.equal(captured.input.confirmation, 'I AUTHORISE CONTROLLED TESTING');
  assert.equal(
    Date.parse(captured.input.windowEnd) - Date.parse(captured.input.windowStart),
    60 * 60 * 1000
  );
});

test('hosted bounded RoE reuses the single active safe local authorisation instead of creating a duplicate', async () => {
  let createCount = 0;
  const active = {
    id: 'roe_existing',
    status: 'active',
    environment: 'local',
    endpointOrigin: 'http://127.0.0.1:8787',
    syntheticDataOnly: true,
    dryRunToolsOnly: true,
    windowStart: '2026-09-11T07:55:00.000Z',
    windowEnd: '2026-09-11T09:00:00.000Z'
  };

  const result = await authoriseHostedBoundedRoe({
    operator,
    body,
    now: () => Date.parse('2026-09-11T08:00:00.000Z'),
    ...dependencies({
      authorisations: [active],
      createAuthorisationImpl: async () => {
        createCount += 1;
        return {};
      }
    })
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reused, true);
  assert.equal(result.body.authorisation.id, 'roe_existing');
  assert.equal(createCount, 0);
});

test('hosted bounded RoE fails closed without the exact explicit confirmation or outside the authoritative gate', async () => {
  await assert.rejects(
    authoriseHostedBoundedRoe({
      operator,
      body: {
        ...body,
        confirmation: 'Authorise and run bounded test'
      },
      ...dependencies()
    }),
    (error) => error?.code === 'HOSTED_BOUNDED_ROE_CONFIRMATION_REQUIRED'
  );

  await assert.rejects(
    authoriseHostedBoundedRoe({
      operator,
      body,
      ...dependencies({
        workflowState: {
          stage: 'finding_required',
          nextAllowedAction: {
            name: 'create_authoritative_finding',
            actor: 'arl',
            requiresUserInput: false
          }
        }
      })
    }),
    (error) => error?.code === 'HOSTED_BOUNDED_ROE_GATE_REQUIRED'
  );
});
