import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('workspace exposes bounded deletion for the latest assessment without deleting the agent', () => {
  const ui = fs.readFileSync(new URL('../public/agent-deletion.js', import.meta.url), 'utf8');

  assert.match(ui, /Delete assessment/);
  assert.match(ui, /data-delete-latest-assessment/);
  assert.match(ui, /\/api\/assessments\/\$\{encodeURIComponent\(latest\.id\)\}/);
  assert.match(ui, /method: 'DELETE'/);
  assert.match(ui, /does not delete the agent project, other assessments, runtime history or billing records/i);
  assert.match(ui, /group\.assessments\[1\]/);
  assert.match(ui, /arl_selected_assessment/);
  assert.doesNotMatch(ui, /deleteLatestAssessment[\s\S]*deleteAgent: true/);
});
