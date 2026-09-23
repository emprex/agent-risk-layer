import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
  renderCustomerAssessmentReport
} from './customer-assessment-report.mjs';

export const CUSTOMER_ASSESSMENT_DELIVERABLE_SCHEMA =
  'arl.customer-assessment-deliverable.v1';

export const CUSTOMER_ASSESSMENT_MANIFEST_SCHEMA =
  'arl.customer-assessment-deliverable-manifest.v1';

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

export function detectCustomerAssessmentDeliverableCommand(userRequest) {
  const text = normalise(userRequest);
  if (!text) return null;

  if (
    /^(?:export|save|write|download)(?: the| my)? (?:customer )?assessment report[.!?]*$/.test(text) ||
    /^(?:export|save|write|download)(?: the| my)? customer report[.!?]*$/.test(text)
  ) {
    return 'customer_assessment_deliverable';
  }

  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(content) {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
}

function cleanStem(value) {
  const stem = String(value || 'assessment')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return stem || 'assessment';
}

function revisionStem(value) {
  const revision = String(value || '').trim();
  return /^[a-f0-9]{7,64}$/i.test(revision)
    ? revision.slice(0, 12).toLowerCase()
    : 'snapshot';
}

function assertSourceReport(report) {
  if (
    report?.schema !== CUSTOMER_ASSESSMENT_REPORT_SCHEMA ||
    report?.available !== true ||
    report?.projection !== 'read_only' ||
    report?.securityStateChanged !== false ||
    report?.deploymentDecisionWritten !== false ||
    report?.humanReviewRequired !== true ||
    report?.readiness?.humanReviewRequired !== true ||
    report?.readiness?.finalDecisionAuthority !== 'human' ||
    report?.readiness?.conversationLayerDecisionWritten !== false ||
    !report?.assessment?.targetRevision ||
    !report?.assessment?.systemSnapshotVersion ||
    !report?.assessment?.controlProfileVersion
  ) {
    const error = new Error(
      'Customer assessment deliverable requires one complete read-only authoritative customer assessment report.'
    );
    error.code = 'CUSTOMER_ASSESSMENT_REPORT_REQUIRED';
    throw error;
  }
}

function fileRecord(name, mediaType, content) {
  return {
    name,
    mediaType,
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
    content
  };
}

function publicFile(file) {
  return {
    name: file.name,
    mediaType: file.mediaType,
    bytes: file.bytes,
    sha256: file.sha256
  };
}

export function buildCustomerAssessmentDeliverable(report) {
  assertSourceReport(report);

  const projectStem = cleanStem(report.assessment.projectName);
  const revision = revisionStem(report.assessment.targetRevision);
  const baseName = `arl-assessment-${projectStem}-${revision}`;
  const markdownContent = `${renderCustomerAssessmentReport(report)}\n`;
  const jsonContent = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = fileRecord(
    `${baseName}.md`,
    'text/markdown; charset=utf-8',
    markdownContent
  );
  const json = fileRecord(
    `${baseName}.json`,
    'application/json',
    jsonContent
  );
  const bundleDigest = sha256(canonicalJson({
    reportSchema: report.schema,
    targetRevision: report.assessment.targetRevision,
    systemSnapshotVersion: report.assessment.systemSnapshotVersion,
    controlProfileVersion: report.assessment.controlProfileVersion,
    readinessStatus: report.readiness.status,
    markdownSha256: markdown.sha256,
    jsonSha256: json.sha256
  }));

  const manifestPayload = {
    schema: CUSTOMER_ASSESSMENT_MANIFEST_SCHEMA,
    reportSchema: report.schema,
    projectName: report.assessment.projectName || null,
    targetRevision: report.assessment.targetRevision,
    systemSnapshotVersion: report.assessment.systemSnapshotVersion,
    controlProfileVersion: report.assessment.controlProfileVersion,
    readinessStatus: report.readiness.status || null,
    finalDecisionAuthority: 'human',
    humanReviewRequired: true,
    integrityClaim: 'sha256_content_digest_only_not_signature',
    files: [publicFile(markdown), publicFile(json)],
    bundleSha256: bundleDigest
  };
  const manifest = fileRecord(
    `${baseName}.manifest.json`,
    'application/json',
    `${JSON.stringify(manifestPayload, null, 2)}\n`
  );

  return {
    schema: CUSTOMER_ASSESSMENT_DELIVERABLE_SCHEMA,
    available: true,
    sourceReportSchema: report.schema,
    projection: 'read_only_export',
    bundleSha256: bundleDigest,
    files: [markdown, json, manifest],
    publicFiles: [
      publicFile(markdown),
      publicFile(json),
      publicFile(manifest)
    ],
    manifest: manifestPayload,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function artifactConflict(filePath) {
  const error = new Error(
    `Refusing to overwrite a different customer assessment artifact: ${filePath}`
  );
  error.code = 'CUSTOMER_ASSESSMENT_ARTIFACT_CONFLICT';
  return error;
}

function assertOutputDirectory(outputDirectory) {
  const requested = String(outputDirectory || '').trim();
  if (!requested) {
    const error = new Error(
      'Customer assessment export requires an explicit output directory.'
    );
    error.code = 'CUSTOMER_ASSESSMENT_OUTPUT_DIRECTORY_REQUIRED';
    throw error;
  }
  return path.resolve(requested);
}

function assertDeliverable(deliverable) {
  if (
    deliverable?.schema !== CUSTOMER_ASSESSMENT_DELIVERABLE_SCHEMA ||
    deliverable?.available !== true ||
    deliverable?.projection !== 'read_only_export' ||
    deliverable?.securityStateChanged !== false ||
    deliverable?.deploymentDecisionWritten !== false ||
    !Array.isArray(deliverable?.files) ||
    deliverable.files.length !== 3
  ) {
    const error = new Error('A valid customer assessment deliverable is required.');
    error.code = 'CUSTOMER_ASSESSMENT_DELIVERABLE_REQUIRED';
    throw error;
  }
}

export function writeCustomerAssessmentDeliverable({
  deliverable,
  outputDirectory
} = {}) {
  assertDeliverable(deliverable);
  const root = assertOutputDirectory(outputDirectory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const planned = deliverable.files.map((file) => {
    const target = path.resolve(root, file.name);
    const relative = path.relative(root, target);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      path.basename(target) !== file.name
    ) {
      const error = new Error('Customer assessment artifact path escaped the output directory.');
      error.code = 'CUSTOMER_ASSESSMENT_OUTPUT_PATH_INVALID';
      throw error;
    }

    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, 'utf8');
      if (existing !== file.content) {
        throw artifactConflict(target);
      }
      return { file, target, status: 'unchanged' };
    }

    return { file, target, status: 'created' };
  });

  for (const item of planned.filter((entry) => entry.status === 'created')) {
    const temporary = `${item.target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, item.file.content, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
      fs.renameSync(temporary, item.target);
    } finally {
      if (fs.existsSync(temporary)) {
        fs.rmSync(temporary, { force: true });
      }
    }
  }

  return {
    schema: 'arl.customer-assessment-deliverable-write.v1',
    available: true,
    outputDirectory: root,
    files: planned.map((item) => ({
      name: item.file.name,
      path: item.target,
      sha256: item.file.sha256,
      bytes: item.file.bytes,
      status: item.status
    })),
    createdFiles: planned.filter((item) => item.status === 'created').length,
    unchangedFiles: planned.filter((item) => item.status === 'unchanged').length,
    artifactStateChanged: planned.some((item) => item.status === 'created'),
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export function publicCustomerAssessmentDeliverable(deliverable) {
  if (deliverable?.available !== true) return null;
  return {
    schema: deliverable.schema,
    available: true,
    sourceReportSchema: deliverable.sourceReportSchema,
    projection: deliverable.projection,
    bundleSha256: deliverable.bundleSha256,
    files: deliverable.publicFiles,
    manifest: deliverable.manifest,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
