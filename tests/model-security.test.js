import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyModelManifest } from '../src/model-security.js';

test('allows an approved immutable safe model manifest', () => {
  const digest = 'a'.repeat(64);
  const result = verifyModelManifest({ modelId:'safe-1', source:'https://models.example/safe', publisher:'Acme', license:'Apache-2.0', sha256:digest, files:[{name:'model.safetensors',safeSerialization:true}] }, { expectedSha256:digest, allowedPublishers:['Acme'] });
  assert.equal(result.decision, 'allow');
});

test('quarantines digest mismatch, unknown publisher and executable payload', () => {
  const result = verifyModelManifest({ modelId:'bad', source:'http://host/bad', publisher:'Unknown', sha256:'b'.repeat(64), files:[{name:'install.sh'}] }, { expectedSha256:'a'.repeat(64), allowedPublishers:['Acme'] });
  assert.equal(result.decision, 'quarantine');
  assert.ok(result.findings.length >= 4);
});
