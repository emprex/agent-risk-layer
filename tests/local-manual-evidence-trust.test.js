import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
  fileURLToPath(new URL('../', import.meta.url));

test('initial manual evidence is explicitly human-verified instead of entering the generic evidence loop', () => {
  const workflow = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );

  assert.match(
    workflow,
    /if \(initialManualEvidenceGate\) \{[\s\S]*verifyExplicitHumanEvidence\(\{/
  );

  assert.match(
    workflow,
    /verificationScope:\s*'explicit_human_manual_control_review'/
  );

  assert.match(
    workflow,
    /Retest evidence keeps its separate explicit[\s\S]*verification step/
  );
});

test('explicit human evidence promotion is integrity checked and append-audited', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/verify-explicit-human-evidence.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /intelligenceDigest\(previousDescriptor\)[\s\S]*row\.integrity_digest/
  );

  assert.match(
    source,
    /verification_state='verified'/
  );

  assert.match(
    source,
    /INSERT INTO control_evidence_trust_revisions/
  );

  assert.match(
    source,
    /verificationScope/
  );
});
