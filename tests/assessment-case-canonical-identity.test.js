import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const facade = fs.readFileSync(path.join(root, 'src', 'control-plane.js'), 'utf8');
const identityProjection = facade.match(
  /async function canonicalAssessmentCaseProject\(project\) \{[\s\S]*?\n\}/,
)?.[0] || '';

test('assessment case identity is derived from its exact canonical assessment', () => {
  assert.match(identityProjection, /project\?\.projectKind !== 'assessment_case'/);
  assert.match(identityProjection, /project\?\.assessmentId/);
  assert.match(identityProjection, /SELECT name FROM assessments WHERE id=\?/);
  assert.match(identityProjection, /return \{ \.\.\.project, name: canonicalName \};/);
  assert.match(facade, /export async function getSecurityProject/);
  assert.match(facade, /export async function controlPlaneOverview/);
});

test('canonical identity projection does not rewrite evidence or historical project metadata', () => {
  assert.ok(identityProjection, 'canonical assessment case identity projection must exist');
  assert.doesNotMatch(identityProjection, /UPDATE\s+/i);
  assert.doesNotMatch(identityProjection, /DELETE\s+FROM/i);
  assert.doesNotMatch(identityProjection, /INSERT\s+INTO/i);
});
