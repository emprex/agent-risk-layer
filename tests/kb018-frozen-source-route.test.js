import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');

test('KB-018 frozen-source collection reuses the existing authoritative append-only recorder', () => {
  const start = workflow.indexOf('if (/^Collect frozen source evidence ARL-KB-018');
  const end = workflow.indexOf('if (/^Refresh frozen dependency inventory ARL-KB-017', start);
  assert.ok(start >= 0 && end > start, 'dedicated KB-018 route precedes unchanged KB-017 route');
  const route = workflow.slice(start, end);
  for (const required of [
    'ARL_EXPECTED_TARGET_SHA',
    'ARL_EXPECTED_SYSTEM_SNAPSHOT_ID',
    'ARL_EXPECTED_PROJECT_ID',
    'localFrozenInspection?.target?.dirty !== false',
    "config?.targetBinding?.source !== 'git'",
    'config.targetBinding.revision !== expected',
    'config?.assessmentBinding?.assessmentId !== options.assessmentId',
    "detail.testDefinition?.id !== 'ARL-CHK-018'",
    'runAuthoritativeControlSourceReview({',
    "controlId:'ARL-KB-018'",
    'collectionOnly:true',
    'deploymentDecisionWritten:false,humanReviewRequired:true'
  ]) assert.ok(route.includes(required), `missing KB-018 guard: ${required}`);
  assert.ok(!route.includes('refreshKb017DependencySource:true'));
});
