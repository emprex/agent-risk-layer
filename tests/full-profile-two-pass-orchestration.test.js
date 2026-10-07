import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('full-profile selection scopes applicability before per-control tests', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/authoritative-workflow-state.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /const fullProfile =\s*Number\(readiness\?\.summary\?\.profileControls \|\| 0\) === 108/
  );

  assert.match(
    source,
    /applicability: 5,[\s\S]*test: 6/
  );
});

test('one Continue assessment resolves consecutive full-profile applicability gates', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /for \(let step = 0; step < 108; step \+= 1\)/
  );

  assert.match(
    source,
    /state\?\.stage !== 'control_applicability_required'/
  );

  assert.match(
    source,
    /assessControlApplicabilityFromLocalOwnerAttestation/
  );

  assert.match(
    source,
    /current =\s*await runArlAgent\([\s\S]*'Where are we\?'/
  );
});


test('full-profile detection does not depend on how many controls are already scoped', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/authoritative-workflow-state.mjs'),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /controlIntelligence\.items\.length === 108/
  );
});
