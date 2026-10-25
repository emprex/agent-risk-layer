import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCustomerAssessmentDeliverable, writeCustomerAssessmentDeliverable }
  from '../src/agent/customer-assessment-deliverable.mjs';
import { inspectCustomerReportDelivery, renderCustomerDeliveryPreflight }
  from '../src/agent/customer-report-delivery-preflight.mjs';

const fixture = () => ({
  schema: 'arl.customer-assessment-report.v1',
  available: true,
  projection: 'read_only',
  assessment: {
    projectName: 'SYNTHETIC staging customer',
    targetRevision: 'c'.repeat(40),
    systemSnapshotVersion: 'synthetic-snapshot-7',
    controlProfileVersion: 'ARL-RKA-1.2.0',
    mappedControlCount: 1,
    scopeStatement: 'Authorised synthetic staging endpoint',
    scopeExclusions: ['Production payment system']
  },
  controls: [{
    controlId: 'ARL-KB-032',
    title: 'SYNTHETIC tool trust control',
    applicability: { status: 'applicable' },
    authorityState: { currentStage: 'review' },
    evidence: {
      currentItems: 1, verifiedActiveItems: 1,
      verifiedActiveIds: ['evi_synthetic_001']
    },
    tests: [{
      testExecutionId: 'tst_synthetic_001',
      result: 'failed',
      executionMethod: 'synthetic_fixture_only',
      restrictedTestDetailsOmitted: true
    }],
    retests: [{
      testExecutionId: 'tst_synthetic_002',
      result: 'inconclusive',
      executionMethod: 'synthetic_fixture_only',
      restrictedTestDetailsOmitted: true
    }],
    findings: [{
      findingId: 'fin_synthetic_001',
      title: 'SYNTHETIC condition not protected',
      contextualSeverity: 'high',
      severityStatus: 'human_review_pending',
      status: 'open'
    }],
    verifiedClosed: false
  }],
  summary: {
    controlsReviewed: 1,
    applicableControls: 1,
    observedControls: 1,
    missingEvidence: ['SYNTHETIC missing side effect log']
  },
  readiness: {
    status: 'HOLD',
    rationale: 'Insufficient independently verified evidence',
    humanReviewRequired: true,
    finalDecisionAuthority: 'human',
    finalDecisionRecorded: false,
    conversationLayerDecisionWritten: false
  },
  limitations: ['Synthetic fixture cannot support a real customer assurance claim.'],
  disclaimer: 'SYNTHETIC ONLY',
  securityStateChanged: false,
  deploymentDecisionWritten: false,
  humanReviewRequired: true
});

function privateFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-delivery-preflight-'));
  try {
    const report = fixture();
    const deliverable = buildCustomerAssessmentDeliverable(report);
    const written = writeCustomerAssessmentDeliverable({
      deliverable,
      outputDirectory: root
    });
    const manifest = written.files.find(f => f.name.endsWith('.manifest.json')).path;
    return run({ root, report, deliverable, written, manifest });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('real file writer -> 3-file verifier -> disclosure -> operator check keeps human authority', () =>
  privateFixture(({ report, deliverable, written, manifest }) => {
    assert.equal(written.createdFiles, 3);
    const inspected = inspectCustomerReportDelivery({
      report, manifestPath: manifest, expectedBundleSha256: deliverable.bundleSha256
    });
    assert.equal(inspected.status, 'INTERNAL_DRAFT_HUMAN_REVIEW_REQUIRED');
    assert.equal(inspected.reportIntegrity, 'consistent_only');
    assert.equal(inspected.filesChecked, 3);
    assert.equal(inspected.bundleSha256, deliverable.bundleSha256);
    assert.equal(inspected.testAndRetestRecords, 2);
    assert.equal(inspected.testExecutionIds, 2);
    assert.equal(inspected.findingsRecorded, 1);
    assert.equal(inspected.findingIds, 1);
    assert.equal(inspected.verifiedEvidenceItems, 1);
    assert.equal(inspected.evidenceReferenceIds, 1);
    assert.equal(inspected.missingEvidenceEntries, 1);
    assert.equal(inspected.customerReleaseApproved, false);
    assert.equal(inspected.automaticDisclosureApproval, false);
    assert.equal(inspected.securityVerdictInferred, false);
    assert.ok(inspected.reviewIssues.some(s => s.includes('reviewer')));
    assert.ok(inspected.reviewIssues.some(s => s.includes('Rules of Engagement')));
    assert.ok(inspected.reviewIssues.some(s => s.includes('missing evidence')));
    const output = renderCustomerDeliveryPreflight(inspected);
    assert.match(output, /NOT APPROVED FOR CUSTOMER RELEASE/);
    assert.match(output, /content consistency, not a signature/);
    assert.match(output, /NO security verdict, certification or release permission/);
  }));

test('delivery check must fail on any altered exported report bytes', () =>
  privateFixture(({ report, deliverable, written, manifest }) => {
    const markdown = written.files.find(f => f.name.endsWith('.md')).path;
    fs.appendFileSync(markdown, 'UNAUTHORISED MODIFICATION');
    assert.throws(() => inspectCustomerReportDelivery({
      report, manifestPath: manifest, expectedBundleSha256: deliverable.bundleSha256
    }), /integrity check failed|mismatch/i);
  }));

test('delivery check rejects a different bundle digest, even for same customer target', () =>
  privateFixture(({ report, manifest }) => {
    assert.throws(() => inspectCustomerReportDelivery({
      report, manifestPath: manifest, expectedBundleSha256: 'f'.repeat(64)
    }), /not consistently bound/);
  }));

test('no test or verified evidence never becomes complete or clear', () =>
  privateFixture(({ report, deliverable, manifest }) => {
    report.controls[0].tests = [];
    report.controls[0].retests = [];
    report.controls[0].evidence = { currentItems: 0, verifiedActiveItems: 0 };
    // Existing exported immutable files intentionally differ from this
    // modified source: quality view alone must not accept changed metadata.
    const qualityMismatch = inspectCustomerReportDelivery({
      report, manifestPath: manifest, expectedBundleSha256: deliverable.bundleSha256
    });
    assert.equal(qualityMismatch.customerReleaseApproved, false);
    assert.ok(qualityMismatch.reviewIssues.some(s => s.includes('No test or retest')));
    assert.ok(qualityMismatch.reviewIssues.some(s => s.includes('No verified active evidence')));
  }));

test('disclosure scanner flags potential secrets without printing their values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-report-secret-check-'));
  const token = 'Authorization: Bearer SYNTHETIC-DO-NOT-DISCLOSE-987654321';
  try {
    const report = fixture();
    report.assessment.scopeStatement = token;
    const bundle = buildCustomerAssessmentDeliverable(report);
    const written = writeCustomerAssessmentDeliverable({ deliverable: bundle, outputDirectory: root });
    const manifest = written.files.find(f => f.name.endsWith('.manifest.json')).path;
    const check = inspectCustomerReportDelivery({
      report, manifestPath: manifest, expectedBundleSha256: bundle.bundleSha256
    });
    assert.ok(check.disclosureFlags > 0);
    assert.ok(check.reviewIssues.some(s => s.includes('sensitive content')));
    assert.equal(check.customerReleaseApproved, false);
    assert.equal(JSON.stringify(check).includes(token), false);
    assert.equal(renderCustomerDeliveryPreflight(check).includes(token), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
