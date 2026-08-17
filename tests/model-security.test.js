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

test('rejects malformed or credential-bearing HTTPS model sources', () => {
  const digest = 'a'.repeat(64);
  for (const source of ['https://', 'https://user:password@models.example/safe', 'javascript:alert(1)']) {
    const result = verifyModelManifest({ modelId:'source-test', source, publisher:'Acme', license:'Apache-2.0', sha256:digest, files:[] }, { expectedSha256:digest, allowedPublishers:['Acme'] });
    assert.equal(result.decision, 'quarantine');
    assert.ok(result.findings.some((finding) => finding.ruleId === 'ARL-MOD-002'));
  }
});

test('manifest evidence digest is canonical across object key order', () => {
  const digest = 'a'.repeat(64);
  const left = verifyModelManifest({ modelId:'safe-1', source:'https://models.example/safe', publisher:'Acme', license:'Apache-2.0', sha256:digest, files:[] });
  const right = verifyModelManifest({ files:[], sha256:digest, license:'Apache-2.0', publisher:'Acme', source:'https://models.example/safe', modelId:'safe-1' });
  assert.equal(left.evidence.manifestDigest, right.evidence.manifestDigest);
});
