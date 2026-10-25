#!/usr/bin/env node
// Offline, human-only report handoff; never creates approvals or findings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCustomerReportBundle } from '../src/agent/customer-report-bundle-verifier.mjs';
import { describeCustomerReportQuality } from '../src/agent/customer-report-professional-narrative.mjs';

export function inspectExistingCustomerBundle(manifestPath) {
  // Verify the report, markdown and manifest *before* reading any data.
  const checked = verifyCustomerReportBundle(manifestPath, { disclosurePreflight: true });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const jsonEntry = manifest.files.find(file =>
    file.mediaType === 'application/json' && file.name.endsWith('.json'));
  if (!jsonEntry) throw new Error('Verified bundle does not contain its report JSON.');
  const reportPath = path.join(path.dirname(path.resolve(manifestPath)), jsonEntry.name);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const quality = describeCustomerReportQuality(report);
  const disclosure = checked.disclosurePreflight;
  const issues = [...quality.reportCompletenessGaps];
  if (quality.testExecutionRecords < 1) issues.push('No executed test or exact retest is evidenced in this projection.');
  if (quality.verifiedActiveEvidenceItems < 1) issues.push('No verified active evidence recorded in the projection.');
  if (quality.recordedMissingEvidenceItems > 0) issues.push('The report contains unresolved missing-evidence items.');
  if (disclosure.flaggedFieldCount > 0) issues.push('Sensitive-data disclosure indicators require manual review.');
  if (disclosure.inspectionIncomplete) issues.push('The privacy review is incomplete.');
  return {
    schema: 'arl.operator-existing-report-review.v1',
    integrity: checked.integrity,
    bundleSha256: checked.bundleSha256,
    targetRevision: checked.targetRevision,
    controlsMapped: quality.factualControlsMapped,
    evidenceItems: quality.verifiedActiveEvidenceItems,
    testAndRetestRecords: quality.testExecutionRecords,
    findingsRecorded: quality.findingsRecorded,
    unresolvedEvidence: quality.recordedMissingEvidenceItems,
    disclosureFlags: disclosure.flaggedFieldCount,
    reviewIssues: issues,
    status: 'INTERNAL_DRAFT_HUMAN_REVIEW_REQUIRED',
    customerReleaseApproved: false,
    securityVerdictInferred: false,
    certified: false,
    databaseModified: false
  };
}

function main(argv) {
  if (argv.length !== 1 || !argv[0].endsWith('.manifest.json'))
    throw new Error('Usage: npm run report:review -- /private/path/arl-assessment-....manifest.json');
  const result = inspectExistingCustomerBundle(argv[0]);
  console.log('ARL CUSTOMER REPORT — INDEPENDENT FILE CHECK\n');
  console.log('Integrity: '+result.integrity+' (not a reviewer signature)');
  console.log('Target revision: '+result.targetRevision);
  console.log('Bundle SHA-256: '+result.bundleSha256);
  console.log('Mapped controls: '+result.controlsMapped);
  console.log('Evidence: '+result.evidenceItems+' verified active items in report');
  console.log('Tests and retests: '+result.testAndRetestRecords);
  console.log('Findings: '+result.findingsRecorded);
  console.log('Unresolved evidence entries: '+result.unresolvedEvidence);
  console.log('Disclosure warning locations: '+result.disclosureFlags);
  console.log('\nRequired human review:');
  for(const issue of result.reviewIssues) console.log('- '+issue);
  console.log('- Verify the exact assessment scope, independent test evidence and retest linkage.');
  console.log('- Record reviewer approval and disclosure authorisation outside this diagnostic.');
  console.log('\nSTATUS: INTERNAL DRAFT — NOT APPROVED FOR CUSTOMER RELEASE.');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch{
    console.error('ARL report verification blocked. Check the exact private manifest and all file permissions.');
    process.exitCode=2;
  }
}
