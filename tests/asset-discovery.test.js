import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAiAssets } from '../src/asset-discovery.js';

test('AI inventory discovers providers, agents, models and privileged exposure', () => {
  const result = discoverAiAssets({ services: [{ name: 'support-agent', type: 'agent', model: 'gpt-5', environment: 'production', tools: ['crm'], public: true }, { name: 'local-review', model: 'ollama/llama3', shell: true }] });
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
