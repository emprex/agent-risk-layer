import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseModelArtifact } from '../src/model-artifact-analysis.js';

test('model analysis rejects executable serialization and digest tampering', () => {
  const result = analyseModelArtifact({ name: 'unsafe.pkl', bytes: Buffer.from('c__builtin__\\nos\\nsystem\\nREDUCE'), expectedSha256: '00'.repeat(32) });
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.quarantine, true);
  assert.ok(result.findings.some((item) => item.ruleId === 'MODEL-EXECUTABLE-SERIALIZATION'));
  assert.ok(result.findings.some((item) => item.ruleId === 'MODEL-DIGEST-MISMATCH'));
});

test('valid bounded SafeTensors metadata is accepted', () => {
  const header = Buffer.from(JSON.stringify({ weight: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
  const result = analyseModelArtifact({ name: 'safe.safetensors', bytes: Buffer.concat([prefix, header, Buffer.alloc(4)]) });
  assert.equal(result.decision, 'ACCEPT');
  assert.equal(result.metadata.tensors, 1);
});
