import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAiAssets } from '../src/asset-discovery.js';

test('AI inventory discovers providers, agents, models and privileged exposure', () => {
  const result = discoverAiAssets({ services: [{ name: 'support-agent', type: 'agent', model: 'gpt-5', environment: 'production', tools: ['crm'], public: true }, { name: 'local-review', model: 'ollama/llama3', shell: true }] });
  assert.equal(result.schema, 'arl.asset-inventory.v2');
  assert.ok(result.summary.total >= 2);
  assert.ok(result.assets.some((asset) => asset.provider === 'openai' && asset.environment === 'production'));
  assert.ok(result.summary.internetExposed >= 1);
  assert.ok(result.summary.privileged >= 1);
});

test('nested assets inherit the manifest environment', () => {
  const result = discoverAiAssets({ name: 'support-agent', type: 'agent', environment: 'development', model: 'gpt-4.1', tools: [{ kind: 'tool', name: 'crm.read' }] });
  assert.ok(result.assets.length >= 2);
  assert.ok(result.assets.every((asset) => asset.environment === 'development'));
});

test('missing privilege and internet exposure declarations remain unknown instead of becoming false', () => {
  const result = discoverAiAssets({ name: 'support-agent', type: 'agent', model: 'gpt-5', environment: 'staging', tools: [{ kind: 'tool', name: 'crm.read' }] });
  assert.ok(result.assets.length >= 2);
  assert.ok(result.assets.every((asset) => asset.privilegeStatus === 'unknown'));
  assert.ok(result.assets.every((asset) => asset.internetExposureStatus === 'unknown'));
  assert.ok(result.assets.every((asset) => asset.privileged === null));
  assert.ok(result.assets.every((asset) => asset.internetExposed === null));
  assert.equal(result.summary.privilegeUnknown, result.summary.total);
  assert.equal(result.summary.internetExposureUnknown, result.summary.total);
  assert.equal(result.summary.evidenceComplete, false);
});

test('explicit negative evidence is distinguished from unknown evidence', () => {
  const result = discoverAiAssets({ name: 'support-agent', type: 'agent', model: 'gpt-5', public: false, privileged: false });
  const agent = result.assets.find((asset) => asset.name === 'support-agent');
  assert.equal(agent.internetExposed, false);
  assert.equal(agent.internetExposureStatus, 'known-false');
  assert.equal(agent.privileged, false);
  assert.equal(agent.privilegeStatus, 'known-false');
  assert.equal(result.summary.internetExposureUnknown, 0);
  assert.equal(result.summary.privilegeUnknown, 0);
});

test('an object with agent structure and a model is classified as an agent', () => {
  const result = discoverAiAssets({ name: 'support-agent', model: 'gpt-5', tools: [{ kind: 'tool', name: 'crm.read' }] });
  assert.equal(result.assets.find((asset) => asset.name === 'support-agent')?.kind, 'agent');
});

test('manifest wrapper objects are not invented as AI assets from descendant provider text', () => {
  const result = discoverAiAssets({
    agent: {
      kind: 'agent',
      name: 'support-agent',
      model: {
        kind: 'model',
        name: 'gpt-4.1',
        provider: 'openai',
        internetExposed: false,
        privileged: false,
      },
      environment: 'staging',
      internetExposed: false,
      privileged: false,
      tools: [
        { kind: 'tool', name: 'crm.read', internetExposed: false, privileged: false },
        { kind: 'tool', name: 'tickets.search', internetExposed: false, privileged: false },
      ],
    },
  });
  assert.deepEqual(result.assets.map((asset) => asset.name).sort(), ['crm.read', 'gpt-4.1', 'support-agent', 'tickets.search']);
  assert.equal(result.summary.total, 4);
  assert.equal(result.summary.privilegeUnknown, 0);
  assert.equal(result.summary.internetExposureUnknown, 0);
  assert.equal(result.summary.evidenceComplete, true);
});
