import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectLocalAssessmentContext
} from '../src/agent/local-assessment-context-view.mjs';

test('local assessment context view exposes confirmed context without internal secrets', () => {
  const view = projectLocalAssessmentContext({
    available: true,
    systemSnapshotId: 'snap_123',
    architecture: {
      summary: 'Local cloned MCP agent repository under development assessment.',
      internalSecret: 'do-not-show'
    },
    assessmentConfiguration: {
      environment: 'development',
      architectureFacts: [
        'tool:network',
        'environment:development',
        'tool:network'
      ],
      manualArchitectureFacts: [
        'environment:development'
      ],
      capabilityProfile: {
        version: 'ARL-CAP-1.2.0',
        evidenceState: 'declared',
        autonomy: 'bounded',
        memory: 'persistent',
        toolDiscovery: 'mcp',
        delegation: 'multi_agent',
        goals: 'decomposed',
        learning: 'none',
        evaluatorAuthority: 'advisory',
        triggerMode: 'user',
        aggregateResourceControl: 'none',
        instructionAuthority: 'mixed',
        instructionActivation: 'mixed',
        instructionProvenance: 'mixed',
        rollbackScope: ['workflow', 'tooling'],
        externalTrust: ['mcp_provider'],
        inputChannels: ['text', 'tool_output'],
        instructionSources: ['system_prompt', 'tool_instruction'],
        secretProfileField: 'do-not-show'
      },
      targetBinding: {
        revision: 'f62d849350816588b1c6294e7914bbe4d8b84072',
        repositoryPath: '/home/emprex/arl-target-mcp-agent',
        credential: 'do-not-show'
      },
      secretConfiguration: 'do-not-show'
    }
  });

  assert.equal(view.available, true);
  assert.equal(view.environment, 'development');
  assert.equal(
    view.targetBinding.revision,
    'f62d849350816588b1c6294e7914bbe4d8b84072'
  );
  assert.deepEqual(
    view.confirmedArchitectureFacts,
    ['environment:development', 'tool:network']
  );
  assert.deepEqual(
    view.manualArchitectureFacts,
    ['environment:development']
  );

  const rendered = JSON.stringify(view);
  assert.equal(rendered.includes('do-not-show'), false);
  assert.equal(view.securityStateChanged, false);
  assert.equal(view.deploymentDecisionWritten, false);
  assert.equal(view.humanReviewRequired, true);
});

test('local assessment context view fails closed when context is unavailable', () => {
  assert.deepEqual(
    projectLocalAssessmentContext({
      available: false,
      reason: 'authoritative_system_snapshot_required'
    }),
    {
      schema: 'arl.local-assessment-context-view.v1',
      available: false,
      reason: 'authoritative_system_snapshot_required',
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    }
  );
});
