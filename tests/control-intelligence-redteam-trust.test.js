import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REDTEAM_TRUST_BOUNDARY, REDTEAM_VERIFICATION_SCOPE, redTeamTrustFromRow } from '../src/control-redteam-evidence.js';

const root = path.resolve(import.meta.dirname, '..');
const digest = (char) => char.repeat(64);
const future = new Date(Date.now() + 86400000).toISOString();

function row(overrides = {}) {
  const descriptor = {
    verificationScope: REDTEAM_VERIFICATION_SCOPE,
    sourceDigest: digest('a'),
    baselineBundleDigest: digest('b'),
    trustBoundary: REDTEAM_TRUST_BOUNDARY,
    redteamRunId: 'rtr_retest',
    redteamBaselineRunId: 'rtr_baseline',
    redteamCaseId: 'RT-PI-002',
  };
  return {
    redteam_run_id: 'rtr_retest',
    redteam_baseline_run_id: 'rtr_baseline',
    redteam_case_id: 'RT-PI-002',
    descriptor_json: JSON.stringify(descriptor),
    redteam_signature_valid: 1,
    redteam_bundle_digest: digest('a'),
    redteam_retention_expires_at: future,
    redteam_baseline_signature_valid: 1,
    redteam_baseline_bundle_digest: digest('b'),
    redteam_baseline_retention_expires_at: future,
    ...overrides,
  };
}

test('bound Red Team evidence remains verified only while both signed sources still match the integrity-bound descriptor', () => {
  const valid = redTeamTrustFromRow(row());
  assert.equal(valid.state, 'verified');
  assert.equal(valid.verificationScope, REDTEAM_VERIFICATION_SCOPE);
  assert.match(valid.trustBoundary, /did not independently operate the target/i);

  const invalidBaselineSignature = redTeamTrustFromRow(row({ redteam_baseline_signature_valid: 0 }));
  assert.equal(invalidBaselineSignature.state, 'unverified');
  assert.match(invalidBaselineSignature.reason, /failed baseline.*valid uploaded signature/i);

  const invalidBaselineDigest = redTeamTrustFromRow(row({ redteam_baseline_bundle_digest: digest('c') }));
  assert.equal(invalidBaselineDigest.state, 'unverified');
  assert.match(invalidBaselineDigest.reason, /failed baseline digest/i);

  const invalidRetestDigest = redTeamTrustFromRow(row({ redteam_bundle_digest: digest('d') }));
  assert.equal(invalidRetestDigest.state, 'unverified');
  assert.match(invalidRetestDigest.reason, /retest bundle digest/i);
});

test('bound Red Team evidence becomes stale when either retained signed source expires', () => {
  const past = new Date(Date.now() - 60000).toISOString();
  const baselineExpired = redTeamTrustFromRow(row({ redteam_baseline_retention_expires_at: past }));
  assert.equal(baselineExpired.state, 'stale');
  assert.match(baselineExpired.reason, /outside its retained evidence window/i);

  const retestExpired = redTeamTrustFromRow(row({ redteam_retention_expires_at: past }));
  assert.equal(retestExpired.state, 'stale');
});

test('binding UI requires explicit human confirmation and states the limited verification scope', () => {
  const html = fs.readFileSync(path.join(root, 'public/control-intelligence-control.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'public/control-intelligence-redteam-binding.js'), 'utf8');
  assert.match(html, /control-intelligence-redteam-binding\.js/);
  assert.match(source, /integrity_verified_customer_operated/);
  assert.match(source, /did not independently operate|not independent operation|not independent target attestation/i);
  assert.match(source, /redteamSnapshotConfirm/);
  assert.match(source, /redteamTrustConfirm/);
  assert.match(source, /confirmAssessmentBinding:\s*document\.querySelector\('#redteamSnapshotConfirm'\)\.checked/);
  assert.match(source, /confirmSnapshotBinding:\s*document\.querySelector\('#redteamSnapshotConfirm'\)\.checked/);
  assert.match(source, /confirmTrustBoundary:\s*document\.querySelector\('#redteamTrustConfirm'\)\.checked/);
  assert.doesNotMatch(source, /click\(\).*redteamBindingForm|dispatchEvent\([^)]*submit/i);
});
