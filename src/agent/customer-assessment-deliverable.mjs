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
  const markdownContent = `${renderCustomerAssessmentReport(report)}\n`;
  const jsonContent = `${JSON.stringify(report, null, 2)}\n`;
  const markdownSha256 = sha256(markdownContent);
  const jsonSha256 = sha256(jsonContent);
  // Even if the assessed Git revision is unchanged, later evidence review
  // can change the report. Keep both snapshots immutable and distinguishable.
  // A digest is a content identifier, NOT a reviewer signature or approval.
  const bundleDigest = sha256(canonicalJson({
    reportSchema: report.schema,
    targetRevision: report.assessment.targetRevision,
    systemSnapshotVersion: report.assessment.systemSnapshotVersion,
    controlProfileVersion: report.assessment.controlProfileVersion,
    readinessStatus: report.readiness.status,
    markdownSha256,
    jsonSha256
  }));
  const baseName = `arl-assessment-${projectStem}-${revision}-${bundleDigest.slice(0, 16)}`;
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
  const root = path.resolve(requested);
  if (root === path.parse(root).root) {
    throw new Error('Refusing filesystem root for customer assessment export.');
  }
  return root;
}

function assertPrivateOutputDirectory(root) {
  let current = root;
  for (;;) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error('Customer report output cannot use symlinked ancestors.');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error('Customer report output requires a private directory (0700).');
  }
}

function privateExistingArtifact(target, file) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || stat.nlink !== 1) {
    throw new Error('Customer report artifact must be a private, regular, unlinked file (0600).');
  }
  if (fs.readFileSync(target, 'utf8') !== file.content) {
    throw artifactConflict(target);
  }
}

function assertDeliverable(deliverable) {
  if (
    deliverable?.schema !== CUSTOMER_ASSESSMENT_DELIVERABLE_SCHEMA ||
    deliverable?.available !== true ||
    deliverable?.projection !== 'read_only_export' ||
    deliverable?.securityStateChanged !== false ||
    deliverable?.deploymentDecisionWritten !== false ||
    !Array.isArray(deliverable?.files) ||
    deliverable.files.length !== 3 ||
    new Set(deliverable.files.map(file => file?.name)).size !== 3 ||
    deliverable.files.some(file =>
      !file || typeof file.name !== 'string' ||
      !/^arl-assessment-[a-z0-9-]+\.(?:md|json|manifest\.json)$/.test(file.name) ||
      path.basename(file.name) !== file.name ||
      typeof file.content !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256 || '') ||
      file.sha256 !== sha256(file.content) ||
      file.bytes !== Buffer.byteLength(file.content)
    )
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
  assertPrivateOutputDirectory(root);

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

    // lstat also catches dangling symlinks: never follow a report path.
    try {
      fs.lstatSync(target);
      privateExistingArtifact(target, file);
      return { file, target, status: 'unchanged' };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    return { file, target, status: 'created' };
  });

  for (const item of planned.filter((entry) => entry.status === 'created')) {
    const temporary = path.join(root,
      '.' + path.basename(item.target) + '.' +
      crypto.randomBytes(12).toString('hex') + '.tmp');
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, item.file.content, { encoding: 'utf8' });
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      try {
        // Atomic no-clobber publication. rename() would overwrite a file
        // created between preflight and publication (including a symlink).
        fs.linkSync(temporary, item.target);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          privateExistingArtifact(item.target, item.file);
          item.status = 'unchanged';
        } else {
          throw error;
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
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
