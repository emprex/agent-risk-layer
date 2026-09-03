import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const planUi = fs.readFileSync(new URL('../public/inspector-evidence-plan.js', import.meta.url), 'utf8');
const inspectorUi = fs.readFileSync(new URL('../public/inspector.js', import.meta.url), 'utf8');

test('Evidence Plan refreshes after hosted source evidence is recorded', () => {
  assert.match(planUi, /arl:source-evidence-recorded/);
  assert.match(planUi, /Source evidence complete\./);
  assert.match(planUi, /not automatically confirmed vulnerabilities/i);
  assert.match(planUi, /attempt < 20/);
});

test('Evidence history does not present static inspection as a whole-system grade or confirmed findings', () => {
  assert.match(inspectorUi, /Observed static source evidence/);
  assert.match(inspectorUi, /source observations/);
  assert.match(inspectorUi, /not automatically confirmed vulnerabilities, a whole-system grade, or a deployment decision/);
  assert.doesNotMatch(inspectorUi, /Posture \$\{s\.postureScore\}\/100 · Grade/);
  assert.doesNotMatch(inspectorUi, /\$\{s\.findingsTotal\} findings/);
});
