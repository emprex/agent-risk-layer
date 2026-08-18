import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('workspace exposes bounded deletion for the latest assessment without deleting the agent', () => {
  const ui = fs.readFileSync(new URL('../public/agent-deletion.js', import.meta.url), 'utf8');
  const start = ui.indexOf('async function deleteLatestAssessment');
  const end = ui.indexOf('async function deleteAgent');
  const latestDeletion = ui.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(ui, /Delete assessment/);
  assert.match(ui, /data-delete-latest-assessment/);
  assert.match(latestDeletion, /\/api\/assessments\/\$\{encodeURIComponent\(latest\.id\)\}/);
  assert.match(latestDeletion, /method: 'DELETE'/);
  assert.match(latestDeletion, /does not delete the agent project, other assessments, runtime history or billing records/i);
  assert.match(latestDeletion, /group\.assessments\[1\]/);
  assert.match(latestDeletion, /arl_selected_assessment/);
  assert.doesNotMatch(latestDeletion, /deleteAgent: true/);
});
