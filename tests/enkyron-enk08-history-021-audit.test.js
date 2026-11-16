import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HISTORICAL, compareArchivedMigration}
  from '../scripts/enkyron-enk08-history-021-audit.mjs';

// Review fixture only: immutable historic bytes, NOT an executable migration.
// Source commit e644d51cfdf256e04989dafc45b4cea4a4e23aa4.
const original = [
  '-- Bind customer remediation scopes to one exact fulfilled Security Assessment.',
  '-- Existing NULL-bound rows remain internal owner assessment cases.',
  '',
  'ALTER TABLE owner_assessment_cases',
  '  ADD COLUMN assessment_id TEXT REFERENCES assessments(id) ON DELETE CASCADE;',
  '',
  'ALTER TABLE owner_assessment_cases',
  '  ADD COLUMN purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT;',
  '',
  'CREATE UNIQUE INDEX idx_owner_assessment_cases_assessment',
  '  ON owner_assessment_cases(assessment_id)',
  '  WHERE assessment_id IS NOT NULL;',
  '',
  'CREATE INDEX idx_owner_assessment_cases_purchase',
  '  ON owner_assessment_cases(purchase_id)',
  '  WHERE purchase_id IS NOT NULL;',
  '',
].join('\n');
const data = Buffer.from(original);

test('ENK-08 history: exact original 021 bytes and ledger hash can match without changes', () => {
  assert.equal(HISTORICAL.version, '021_paid_assessment_remediation_scope.sql');
  assert.equal(HISTORICAL.commit, 'e644d51cfdf256e04989dafc45b4cea4a4e23aa4');
  const result = compareArchivedMigration(data, HISTORICAL.sha256, false);
  assert.equal(result.archive_sha256, HISTORICAL.sha256);
  assert.equal(result.provenance_verified_for_review, true);
  assert.equal(result.ledger_checksum_matches_archive, true);
  assert.equal(result.ledger_modified, false);
  assert.equal(result.archive_restored, false);
  assert.equal(result.migration_executed, false);
  assert.equal(result.release_approved, false);
});

test('ENK-08 history: any changes to historical SQL bytes fail provenance', () => {
  const modified = Buffer.from(original.replace('ON DELETE CASCADE', 'ON DELETE RESTRICT'));
  const result = compareArchivedMigration(modified, HISTORICAL.sha256, false);
  assert.equal(result.provenance_verified_for_review, false);
  assert.match(result.issues.join(' '), /archived source bytes/);
});

test('ENK-08 history: incorrect ledger checksum fails independently', () => {
  const result = compareArchivedMigration(data, 'f'.repeat(64), false);
  assert.equal(result.provenance_verified_for_review, false);
  assert.match(result.issues.join(' '), /recorded exact-filename/);
});

test('ENK-08 history: unexpected active migration source remains a STOP', () => {
  const result = compareArchivedMigration(data, HISTORICAL.sha256, true);
  assert.equal(result.provenance_verified_for_review, false);
  assert.match(result.issues.join(' '), /unexpectedly present/);
});

test('ENK-08 history: malformed inputs are rejected', () => {
  assert.throws(() => compareArchivedMigration(original, HISTORICAL.sha256, false), /invalid/);
  assert.throws(() => compareArchivedMigration(data, null, false), /invalid/);
  assert.throws(() => compareArchivedMigration(data, HISTORICAL.sha256, 'false'), /invalid/);
});

test('ENK-08 history: read-only fixed identity, no migration loader or restore', () => {
  const source = readFileSync(
    new URL('../scripts/enkyron-enk08-history-021-audit.mjs', import.meta.url), 'utf8');
  assert.match(source, /host: '\/var\/run\/postgresql'/);
  assert.match(source, /database: 'arl_local'/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /default_transaction_read_only=on/);
  assert.match(source, /process\.argv\[2\] !== '--check'/);
  assert.match(source, /HISTORICAL\.commit \+ ':migrations\/'/);
  assert.doesNotMatch(source, /runMigrations\s*\(/);
  assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(source, /git',\s*\[\s*'checkout'/);
});
