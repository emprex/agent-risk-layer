import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedDeterministicEvidenceJson } from '../src/agent/tools/run-authoritative-control-test.mjs';

const payload = {
  schema: 'arl.deterministic-evidence-collection.v1',
  targetRevision: 'a'.repeat(40),
  requirementObservations: [{
    requirement: 'ARL-KB-008 assessed system, exact version, environment and applicable data/human-interaction scope',
    collectors: ['target_identity'],
    observations: {target_identity: {revision: 'a'.repeat(40)}}
  }]
};

test('bounded structured evidence preserves a complete parseable payload', () => {
  const text = boundedDeterministicEvidenceJson(payload);
  assert.equal(text, JSON.stringify(payload));
  assert.deepEqual(JSON.parse(text), payload);
});

test('boundary accepts exact length and rejects one character below size', () => {
  const size = JSON.stringify(payload).length;
  assert.equal(boundedDeterministicEvidenceJson(payload, size), JSON.stringify(payload));
  assert.equal(boundedDeterministicEvidenceJson(payload, size - 1), null);
});

test('oversized structured evidence is rejected rather than truncated', () => {
  const huge = {...payload, requirementObservations: [
    ...payload.requirementObservations,
    {requirement:'extra',collectors:['source_and_configuration'],observations:{source_and_configuration:{detail:'x'.repeat(20000)}}}
  ]};
  assert.equal(boundedDeterministicEvidenceJson(huge), null);
  assert.deepEqual(payload.requirementObservations.length, 1);
});
