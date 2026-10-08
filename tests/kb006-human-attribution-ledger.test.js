import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');

test('KB-006 review deduplicates test and history by execution id', () => {
  const start = source.indexOf("if (/^review kb-006 finding[.!?]*$/i.test(request.trim()))");
  assert.ok(start >= 0);
  assert.match(source.slice(start, start + 1100), /new Map\([\s\S]*?\.map\(item => \[item\.id, item\]\)/);
});

test('human attribution attestation must be tied to persisted open finding, failed test and snapshot', () => {
  const start = source.indexOf("if (request.startsWith('Record KB-006 attribution review '))");
  const end = source.indexOf("if (/^review kb-006 finding[.!?]*$/i.test(request.trim()))", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /attribution_disputed/);
  assert.match(block, /further_investigation_required/);
  assert.match(block, /reason\.length < 40/);
  assert.match(block, /item\.status === 'open'/);
  assert.match(block, /item\.findingId === finding\?\.id/);
  assert.match(block, /input\.systemSnapshotId !== detail\?\.systemSnapshot\?\.id/);
  assert.match(block, /INSERT INTO events/);
  assert.match(block, /actorId: options\.userId/);
  assert.match(block, /findingClosed: false/);
  assert.match(block, /deploymentDecisionWritten: false/);
  assert.doesNotMatch(block, /UPDATE |DELETE |closeControlFinding|recordControlTestExecution|recordControlEvidence/);
});
