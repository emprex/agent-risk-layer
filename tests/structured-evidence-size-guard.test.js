import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedDeterministicEvidenceJson, frozenInspectionObservation } from '../src/agent/tools/run-authoritative-control-test.mjs';

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

test('small frozen inspection summary stays parseable', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{schema:'v1', observedTechnologies:['python']}},
    requirements:['system version']
  });
  assert.equal(JSON.parse(text).targetRevision, 'a'.repeat(40));
});

test('large frozen inspection summary is reduced without creating partial JSON', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{
      observedTechnologies: Array.from({length:60}, (_,i)=>({name:'provider'+i, note:'x'.repeat(150)}))
    }},
    requirements:[]
  });
  assert.equal(typeof text, 'string');
  assert.ok(text.length <= 5000);
  assert.deepEqual(JSON.parse(text).observedTechnologies.length, 20);
});

test('oversized fallback summary fails closed', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{
      observedTechnologies: Array.from({length:60}, (_,i)=>({name:'provider'+i, note:'x'.repeat(750)}))
    }}
  });
  assert.equal(text, null);
});
