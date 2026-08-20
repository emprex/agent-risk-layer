import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const facade = fs.readFileSync(path.join(root, 'src', 'control-plane.js'), 'utf8');

test('assessment case identity is derived from its exact canonical assessment', () => {
  assert.match(facade, /project\?\.projectKind !== 'assessment_case'/);
  assert.match(facade, /project\?\.assessmentId/);
  assert.match(facade, /SELECT name FROM assessments WHERE id=\?/);
  assert.match(facade, /canonicalAssessmentCaseProject/);
  assert.match(facade, /export async function getSecurityProject/);
  assert.match(facade, /export async function controlPlaneOverview/);
});

test('canonical identity projection does not rewrite evidence or historical project metadata', () => {
  assert.doesNotMatch(facade, /UPDATE\s+security_projects/i);
  assert.doesNotMatch(facade, /UPDATE\s+remediation_items/i);
  assert.doesNotMatch(facade, /UPDATE\s+inspections/i);
  assert.doesNotMatch(facade, /DELETE\s+FROM/i);
});
