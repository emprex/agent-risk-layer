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


test('a repeated manual evidence command can recover the exact prior evidence at the evidence stage', () => {
  const workflow = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );

  assert.match(
    workflow,
    /existingManualEvidenceGate =[\s\S]*evidence_recording_required[\s\S]*record_authoritative_evidence/
  );

  assert.match(
    workflow,
    /explicit_human_manual_control_review_recovery/
  );

  assert.match(
    workflow,
    /passed\.length !== 1 \|\| evidence\.length !== 1/
  );
});


test('manual evidence recording stage auto-promotes persisted operator evidence instead of asking for the same input again', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/authoritative-auto-actions.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /action\.name === 'record_authoritative_evidence'[\s\S]*if \(action\.caseId\)[\s\S]*promotePersistedManualEvidence/
  );

  assert.match(
    source,
    /sourceType === 'manual_review'/
  );

  assert.match(
    source,
    /verificationState === 'unverified'/
  );

  assert.match(
    source,
    /explicit_human_manual_control_review_auto_promotion/
  );
});


test('conclusive manual evidence is checked against the exact canonical Risk Knowledge checklist before test recording', () => {
  const workflow = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );
  const checklist = fs.readFileSync(
    path.join(root, 'src/agent/manual-evidence-checklist.mjs'),
    'utf8'
  );

  assert.match(
    workflow,
    /validateCanonicalManualEvidenceChecklist/
  );

  assert.match(
    checklist,
    /workflowState\?\.evidenceWorkQueue\?\.items/
  );

  assert.match(
    checklist,
    /Conclusive manual evidence must address the exact remaining human-only canonical evidence checklist/
  );

  assert.match(
    workflow,
    /checklistValidation\.observedResult/
  );

  assert.match(
    workflow,
    /Canonical remaining human-only evidence checklist verified against Risk Knowledge/
  );
});
