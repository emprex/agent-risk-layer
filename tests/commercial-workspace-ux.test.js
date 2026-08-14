import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspacePages = [
  'public/dashboard.html',
  'public/result.html',
  'public/control-intelligence.html',
  'public/assessment.html',
];

test('commercial workspace assets are scoped to the four authenticated refactor surfaces', () => {
  for (const page of workspacePages) {
    const html = read(page);
    assert.match(html, /\/workspace-ux\.css/);
    assert.match(html, /\/workspace-ux\.js/);
  }
  for (const page of ['public/index.html', 'public/pricing.html', 'public/trust.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /\/workspace-ux\.(?:css|js)/);
  }
});

test('workspace layer remains presentation-only and does not issue mutations', () => {
  const js = read('public/workspace-ux.js');
  assert.doesNotMatch(js, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.match(js, /api\(`\/api\/projects\/\$\{encodeURIComponent\(project\)\}\/control-intelligence\?limit=8`\)/);
});

test('Control Intelligence never invents a deployment decision when none is recorded', () => {
  const js = read('public/workspace-ux.js');
  assert.match(js, /const rawDecision = deployment\?\.decision \? String\(deployment\.decision\) : ''/);
  assert.match(js, /Decision not recorded yet/);
  assert.match(js, /The underlying page already owns error reporting\. The UX layer must never mask it\./);
});

test('assessment keeps the questionnaire but presents five calmer progress sections', () => {
  const js = read('public/workspace-ux.js');
  for (const label of ['Agent & access', 'Data & inputs', 'Actions & authority', 'Controls & approval', 'Recovery & evidence']) {
    assert.match(js, new RegExp(label.replace(/[&]/g, '\\&')));
  }
  assert.match(js, /Question \$\{questionNumber\}/);
  assert.match(js, /Unknown information stays an information gap; it is not turned into a vulnerability/);
});

test('result progressively discloses findings and preserves the paid assessment trust boundary', () => {
  const js = read('public/workspace-ux.js');
  assert.match(js, /View \$\{cards\.length - visibleCount\} additional item/);
  assert.match(js, /Turn this check into an evidence-backed £99 assessment/);
  assert.match(js, /without claiming evidence that has not actually been collected/);
});
