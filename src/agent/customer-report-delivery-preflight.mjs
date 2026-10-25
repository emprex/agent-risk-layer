import path from 'node:path';

import { verifyCustomerReportBundle } from './customer-report-bundle-verifier.mjs';
import { buildCustomerAssessmentDeliverable } from './customer-assessment-deliverable.mjs';
import { describeCustomerReportQuality } from './customer-report-professional-narrative.mjs';

export const CUSTOMER_DELIVERY_PREFLIGHT_SCHEMA =
  'arl.customer-assessment-delivery-preflight.v1';

// This is the operator's LOCAL gate immediately after the existing report export.
// Digest checks prove byte consistency, never evidence truth, ownership permission,
// accountable independent review, accreditation or customer-release approval.
export function inspectCustomerReportDelivery({
  report, manifestPath, expectedBundleSha256
} = {}) {
  if (typeof manifestPath !== 'string' || !manifestPath.endsWith('.manifest.json') ||
      typeof expectedBundleSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedBundleSha256)) {
    throw new Error('Exact report manifest and expected SHA-256 are required.');
  }
  // Reconstruct the digest from the exact in-memory report, too. Otherwise a
  // caller could attach an old consistent bundle to newly edited source data.
  const expectedFromSource = buildCustomerAssessmentDeliverable(report);
  if (expectedFromSource.bundleSha256 !== expectedBundleSha256) {
    throw new Error('Customer source projection disagrees with exported immutable bundle.');
  }
  const quality = describeCustomerReportQuality(report);
  const verified = verifyCustomerReportBundle(manifestPath, {
    disclosurePreflight: true
  });
  const disclosure = verified.disclosurePreflight;

  if (verified.integrity !== 'consistent_only' ||
      verified.authenticity !== 'not_verified_no_signature' ||
      verified.reportSecurityVerdict !== 'not_assessed' ||
      verified.filesChecked !== 3 ||
      verified.bundleSha256 !== expectedBundleSha256 ||
      verified.targetRevision !== report.assessment?.targetRevision ||
      verified.systemSnapshotVersion !== report.assessment?.systemSnapshotVersion ||
      verified.readinessStatus !== report.readiness?.status ||
      verified.humanReviewRequired !== true ||
      disclosure?.automaticDisclosureApproval !== false ||
      disclosure?.status !== 'HUMAN_DISCLOSURE_REVIEW_REQUIRED') {
    throw new Error('Customer export is not consistently bound to its authoritative report.');
  }

  const issues = [...quality.reportCompletenessGaps];
  if (quality.testExecutionRecords === 0) {
    issues.push('No test or retest execution records are included: cannot support a full technical assessment claim.');
  }
  if (quality.verifiedActiveEvidenceItems === 0) {
    issues.push('No verified active evidence items appear in the report: security results are unsubstantiated.');
  }
  if (quality.recordedMissingEvidenceItems > 0) {
    issues.push('The authoritative report identifies unresolved missing evidence.');
  }
  if (disclosure.flaggedFieldCount > 0) {
    issues.push('The privacy screen found potentially sensitive content; assess every flagged location before disclosure.');
  }
  if (disclosure.inspectionIncomplete === true) {
    issues.push('The bounded privacy scan was incomplete; do not infer that the report is safe to share.');
  }

  // Never accept an inferred PASS, automated customer disclosure or a synthetic
  // human sign-off. A report with open vulnerabilities may be sent after
  // accountable, scope-appropriate review; zero findings is not a clean bill.
  return {
    schema: CUSTOMER_DELIVERY_PREFLIGHT_SCHEMA,
    status: 'INTERNAL_DRAFT_HUMAN_REVIEW_REQUIRED',
    manifestPath: path.resolve(manifestPath),
    bundleSha256: verified.bundleSha256,
    reportIntegrity: 'consistent_only',
    authenticity: 'not_verified_no_signature',
    filesChecked: verified.filesChecked,
    targetRevision: verified.targetRevision,
    readinessStatus: verified.readinessStatus,
    mappedControls: quality.factualControlsMapped,
    verifiedEvidenceItems: quality.verifiedActiveEvidenceItems,
    evidenceReferenceIds: quality.evidenceReferenceIds,
    testAndRetestRecords: quality.testExecutionRecords,
    testExecutionIds: quality.testExecutionIds,
    findingsRecorded: quality.findingsRecorded,
    findingIds: quality.findingIds,
    missingEvidenceEntries: quality.recordedMissingEvidenceItems,
    disclosureFlags: disclosure.flaggedFieldCount,
    disclosureScanIncomplete: disclosure.inspectionIncomplete,
    reviewIssues: issues,
    customerReleaseApproved: false,
    certified: false,
    automaticDisclosureApproval: false,
    securityVerdictInferred: false,
    humanReviewRequired: true,
    operatorNextActions: [
      'Check scope, exclusions, object/release identity, signed written ROE and owner permission.',
      'Independently verify tests, tool/resource side effects and each evidence reference.',
      'Confirm applicability, findings, severity, remediation and exact retest lineage.',
      'Resolve disclosure flags and review the exact immutable Markdown, JSON and manifest files.',
      'Record accountable independent reviewer identity, conflicts, sign-off and customer disclosure approval.'
    ]
  };
}

export function renderCustomerDeliveryPreflight(summary) {
  if (summary?.schema !== CUSTOMER_DELIVERY_PREFLIGHT_SCHEMA ||
      summary?.status !== 'INTERNAL_DRAFT_HUMAN_REVIEW_REQUIRED' ||
      summary?.customerReleaseApproved !== false ||
      summary?.humanReviewRequired !== true ||
      summary?.automaticDisclosureApproval !== false ||
      summary?.reportIntegrity !== 'consistent_only') {
    throw new Error('Invalid operator delivery preflight: no release authority may be inferred.');
  }
  const issueLines = summary.reviewIssues.length > 0
    ? summary.reviewIssues.map((item, index) =>
      '  ' + (index + 1) + '. ' + item)
    : ['  None automatically detected; independent human review is still required.'];
  return [
    'CUSTOMER REPORT · LOCAL DELIVERY CHECK',
    'State: INTERNAL DRAFT — NOT APPROVED FOR CUSTOMER RELEASE',
    'Report manifest: ' + summary.manifestPath,
    'Bundle SHA-256: ' + summary.bundleSha256,
    'Immutable files: ' + summary.filesChecked + ' verified (content consistency, not a signature)',
    'Assessed target: ' + summary.targetRevision,
    'Recorded readiness: ' + (summary.readinessStatus || 'unknown'),
    'Controls mapped: ' + summary.mappedControls +
      ' · verified evidence: ' + summary.verifiedEvidenceItems +
      ' · evidence IDs: ' + summary.evidenceReferenceIds,
    'Tests and retests: ' + summary.testAndRetestRecords +
      ' · execution IDs: ' + summary.testExecutionIds,
    'Findings: ' + summary.findingsRecorded +
      ' · finding IDs: ' + summary.findingIds +
      ' · missing evidence entries: ' + summary.missingEvidenceEntries,
    'Disclosure warning locations: ' + summary.disclosureFlags +
      (summary.disclosureScanIncomplete ? ' (scan incomplete)' : ''),
    '',
    'Issues to resolve before claiming assessment completeness:',
    ...issueLines,
    '',
    'Accountable operator checklist:',
    ...summary.operatorNextActions.map((step,index)=>'  '+(index+1)+'. '+step),
    '',
    'NO security verdict, certification or release permission was generated.'
  ].join('\n');
}
