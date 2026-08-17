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

test('SafeTensors analysis rejects overlapping tensor data ranges', () => {
  const header = Buffer.from(JSON.stringify({
    first: { dtype: 'F32', shape: [1], data_offsets: [0, 4] },
    second: { dtype: 'F32', shape: [1], data_offsets: [2, 6] },
  }));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
  const result = analyseModelArtifact({ name: 'overlap.safetensors', bytes: Buffer.concat([prefix, header, Buffer.alloc(6)]) });
  assert.equal(result.decision, 'REJECT');
  assert.ok(result.findings.some((item) => item.ruleId === 'MODEL-TENSOR-OVERLAP'));
});

test('SafeTensors analysis rejects tensor ranges beyond the data section', () => {
  const header = Buffer.from(JSON.stringify({ weight: { dtype: 'F32', shape: [2], data_offsets: [0, 8] } }));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length));
  const result = analyseModelArtifact({ name: 'truncated.safetensors', bytes: Buffer.concat([prefix, header, Buffer.alloc(4)]) });
  assert.equal(result.decision, 'REJECT');
  assert.ok(result.findings.some((item) => item.ruleId === 'MODEL-TENSOR-TRUNCATED'));
});
