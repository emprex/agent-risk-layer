import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('dashboard surfaces a recorded assessment deployment decision without a linked evidence project', () => {
  const html = read('public/dashboard.html');
  const fix = read('public/dashboard-assessment-decision.js');

  assert.match(html, /dashboard-assessment-decision\.js/);
  assert.match(fix, /assessment\.result\?\.deploymentDecision/);
  assert.match(fix, /Assessment decision: \$\{label\}/);
  assert.match(fix, /Assessment complete · \$\{label\}/);
  assert.match(fix, /Close remaining evidence gaps before reassessment/);
  assert.match(fix, /Do not create remediation work unless evidence confirms a finding/);
  assert.match(fix, /Review decision/);
  assert.match(fix, /No linked evidence project is required to display this assessment decision/);
});

test('dashboard assessment decision overlay does not replace linked-project deployment evidence', () => {
  const fix = read('public/dashboard-assessment-decision.js');
  assert.match(fix, /No exact-name evidence project is linked from this dashboard view/);
  assert.match(fix, /if \(!noLinkedProject\) return null/);
});
