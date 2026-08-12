import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAPABILITY_PROFILE_VERSION,
  CAPABILITY_DIMENSIONS,
  CAPABILITY_MULTI_DIMENSIONS,
  capabilityProfileSummary,
  deriveCapabilityFacts,
  normaliseCapabilityProfile,
  sameCapabilityProfile,
} from '../public/agent-capability-profile.js';

const root = path.resolve(import.meta.dirname, '..');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('capability profile is fixed-schema, deterministic and keeps unknown as context', () => {
  assert.equal(CAPABILITY_PROFILE_VERSION, 'ARL-CAP-1.0.0');
  const unknown = normaliseCapabilityProfile({
    autonomy: 'invented',
    memory: 'invented',
    rollbackScope: ['model', 'bogus', 'model'],
    inputChannels: ['web', 'text', 'web'],
    surprise: 'must-not-survive-normalisation',
  });
  assert.equal(unknown.version, CAPABILITY_PROFILE_VERSION);
  assert.equal(unknown.evidenceState, 'declared');
  assert.equal(unknown.autonomy, 'unknown');
  assert.equal(unknown.memory, 'unknown');
  assert.deepEqual(unknown.rollbackScope, ['model']);
  assert.deepEqual(unknown.inputChannels, ['text', 'web']);
  assert.equal(Object.hasOwn(unknown, 'surprise'), false);
  for (const dimension of CAPABILITY_DIMENSIONS) assert.ok(Object.hasOwn(unknown, dimension.key));
  for (const dimension of CAPABILITY_MULTI_DIMENSIONS) assert.ok(Array.isArray(unknown[dimension.key]));
  assert.deepEqual(normaliseCapabilityProfile(unknown), unknown);
  assert.deepEqual(deriveCapabilityFacts(normaliseCapabilityProfile({})), []);
});

test('only conservative capability facts are derived into the existing suggestion vocabulary', () => {
  const facts = deriveCapabilityFacts({
    autonomy: 'adaptive',
    memory: 'shared',
    rollbackScope: ['memory'],
    inputChannels: ['text', 'email', 'file', 'web', 'voice', 'image', 'sensor', 'tool_output', 'memory'],
    delegation: 'multi_agent',
    toolDiscovery: 'mcp',
    learning: 'self_modifying',
    evaluatorAuthority: 'changes_policy',
    aggregateResourceControl: 'authoritative_downstream',
  });
  assert.deepEqual(facts, [
    'authority:autonomous',
    'input:email',
    'input:memory',
    'input:tool_output',
    'input:uploaded_files',
    'input:user_messages',
    'input:web_content',
    'safeguard:recovery',
  ]);
  for (const unsupported of ['multi_agent','mcp','self_modifying','changes_policy','voice','image','sensor','aggregate']) {
    assert.equal(facts.some((fact) => fact.includes(unsupported)), false, `Unexpected inferred fact for ${unsupported}`);
  }
});

test('capability comparison and display use canonical declared values', () => {
  const left = { autonomy: 'bounded', rollbackScope: ['model', 'policy'], inputChannels: ['web', 'text'] };
  const right = { inputChannels: ['text', 'web'], rollbackScope: ['policy', 'model'], autonomy: 'bounded' };
  assert.equal(sameCapabilityProfile(left, right), true);
  assert.equal(sameCapabilityProfile(left, { ...right, autonomy: 'autonomous' }), false);
  const summary = capabilityProfileSummary(left);
  assert.ok(summary.some((row) => row.key === 'autonomy' && row.value === 'bounded'));
  assert.ok(summary.some((row) => row.key === 'rollbackScope' && /Policy/.test(row.display) && /Model/.test(row.display)));
});

test('Control Intelligence integrates capability context without promoting it to evidence or findings', () => {
  const overview = read('public/control-intelligence.js');
  const remediation = read('public/control-intelligence-capability-remediation.js');
  const controlHtml = read('public/control-intelligence-control.html');
  const report = read('public/control-intelligence-report.js');

  assert.match(overview, /capabilityProfile/);
  assert.match(overview, /manualArchitectureFacts/);
  assert.match(overview, /autonomyLevel:capabilityProfile\.autonomy/);
  assert.match(overview, /expectedCurrentSnapshotId:current\.id/);
  assert.match(overview, /Unknown values remain unknown and do not create findings/);
  assert.match(overview, /not observed evidence or a finding/);

  assert.match(remediation, /capabilityProfile/);
  assert.match(remediation, /autonomyLevel: profile\.autonomy/);
  assert.match(remediation, /expectedCurrentSnapshotId: current\.id/);
  assert.match(remediation, /Capabilities and unknowns are context, not findings/);
  assert.match(remediation, /Prior evidence remains historical/);
  assert.match(controlHtml, /control-intelligence-capability-remediation\.js/);

  assert.match(report, /customer-declared context/);
  assert.match(report, /not observed evidence, a vulnerability, a finding or certification/);
  assert.match(report, /Agent Capability Profile/);
});
