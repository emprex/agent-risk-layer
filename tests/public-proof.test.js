import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

test('controlled support-agent proof has a reproducible digest and honest limitations', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'public/downloads/agentrisklayer-controlled-support-agent-proof.json'), 'utf8'));
  const integrity = proof.integrity;
  delete proof.integrity;
  const digest = crypto.createHash('sha256').update(canonicalJson(proof)).digest('hex');
  assert.equal(digest, integrity.digest);
  assert.equal(proof.assessment.platformVersion, '9.2.0');
  assert.deepEqual(proof.evidenceChain.map((item) => item.stage), [
    'Declared Controls', 'Observed Controls', 'Findings', 'Red-Team Evidence', 'Runtime Evidence',
    'Human Approval', 'Remediation', 'Retest', 'Deployment Decision',
  ]);
  assert.match(proof.limitations.join(' '), /synthetic/i);
  assert.match(proof.limitations.join(' '), /not an accredited certification/i);
  assert.match(proof.limitations.join(' '), /production deployment/i);
  const observed = proof.evidenceChain.find((item) => item.stage === 'Observed Controls').evidence.join(' ');
  assert.match(observed, /bearer token omits the internal approver identifier/i);
});
