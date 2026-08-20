import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations', '022_canonical_assessment_case_identity.sql'), 'utf8');

test('assessment-bound case name is repaired from the canonical assessment identity', () => {
  assert.match(migration, /UPDATE security_projects/i);
  assert.match(migration, /JOIN assessments a ON a\.id = c\.assessment_id/i);
  assert.match(migration, /c\.project_id = security_projects\.id/i);
  assert.match(migration, /a\.name <> security_projects\.name/i);
});

test('identity repair does not rewrite evidence or remediation history', () => {
  assert.doesNotMatch(migration, /UPDATE\s+remediation_items/i);
  assert.doesNotMatch(migration, /UPDATE\s+inspections/i);
  assert.doesNotMatch(migration, /UPDATE\s+security_audit_log/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
