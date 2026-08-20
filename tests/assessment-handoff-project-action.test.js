import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const script = fs.readFileSync(path.join(root, 'public', 'remediation-handoff-clarity.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'control-plane.html'), 'utf8');

test('assessment handoff disables unrelated projects instead of presenting a dead action', () => {
  assert.match(script, /select\.value = ''/);
  assert.match(script, /option\.disabled = true/);
  assert.match(script, /button\.disabled = true/);
  assert.match(script, /No matching project/);
  assert.match(script, /cannot be linked to a different agent/);
});

test('exact matching assessment project remains actionable', () => {
  assert.match(script, /if \(exact && clarifyExactProjectReuse/);
  assert.match(script, /select\.value = exact\.id/);
  assert.match(script, /button\.disabled = false/);
  assert.match(script, /Use matching project/);
});

test('eligible assessment can choose its exact dedicated remediation scope from the same menu', () => {
  assert.match(script, /overview\?\.assessmentCases\?\.canCreate \|\| assessment\?\.paidTier !== 'free'/);
  assert.match(script, /__create_assessment_scope__/);
  assert.match(script, /create dedicated remediation scope/);
  assert.match(script, /Create matching Atlas scope/);
  assert.match(script, /createAssessmentRemediationCase/);
  assert.match(script, /stopImmediatePropagation/);
});

test('handoff clarification asset is cache-busted', () => {
  assert.match(html, /remediation-handoff-clarity\.js\?v=20260820\.2/);
});
