import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareCustomerReportDisclosurePreflight }
  from './customer-report-disclosure-preflight.mjs';

const MANIFEST_SCHEMA = 'arl.customer-assessment-deliverable-manifest.v1';
const REPORT_SCHEMA = 'arl.customer-assessment-report.v1';
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

function projectStem(value) {
  const stem=String(value || 'assessment').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
  return stem || 'assessment';
}

function revisionStem(value) {
  const revision=String(value || '').trim();
  return /^[a-f0-9]{7,64}$/i.test(revision)
    ? revision.slice(0,12).toLowerCase() : 'snapshot';
}

function required(ok, message) {
  if (!ok) throw new Error('Customer report integrity check failed: ' + message);
}

function assertPrivateAncestry(directory) {
  let current=directory;
  for (;;) {
    const stat=fs.lstatSync(current);
    required(!stat.isSymbolicLink(), 'symlinked directory path');
    const parent=path.dirname(current);
    if (parent===current) break;
    current=parent;
  }
  const stat=fs.statSync(directory);
  required(stat.isDirectory() && (stat.mode & 0o077) === 0,
    'report directory is not private (0700)');
}

function readPrivateFile(filename, maxBytes) {
  const inspected=fs.lstatSync(filename);
  required(inspected.isFile() && !inspected.isSymbolicLink() &&
    (inspected.mode & 0o077) === 0 && inspected.nlink === 1,
    'report contains a non-private, linked, or non-regular file');
  required(inspected.size <= maxBytes, 'report file exceeds bounded size');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened=fs.fstatSync(fd);
    required(opened.isFile() && opened.nlink===1 && (opened.mode & 0o077)===0 &&
      opened.dev===inspected.dev && opened.ino===inspected.ino &&
      opened.size<=maxBytes, 'report file changed while opening');
    const bytes=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    required(bytes.length<=maxBytes &&
      opened.dev===after.dev && opened.ino===after.ino &&
      opened.size===after.size && opened.mtimeMs===after.mtimeMs &&
      bytes.length===after.size, 'report file changed while reading');
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Customer report integrity check failed: malformed '+label); }
}

function verifyRow(row, name, mediaType, bytes) {
  required(row && typeof row==='object' &&
    row.name===name && row.mediaType===mediaType &&
    Number.isSafeInteger(row.bytes) && row.bytes===bytes.length &&
    SHA256.test(row.sha256 || '') && row.sha256===hash(bytes),
    'file inventory, length or SHA-256 digest mismatch');
}

// Purely read-only file consistency. A digest is not a signature, evidence
// verification, audit finding or approval, even if every hash matches.
export function verifyCustomerReportBundle(manifestPath, { disclosurePreflight=false }={}) {
  required(typeof manifestPath==='string' && manifestPath.trim().length>0,
    'provide the exact .manifest.json path');
  const filePath=path.resolve(manifestPath);
  const root=path.dirname(filePath);
  required(root!==path.parse(root).root,'filesystem root is not a report directory');
  assertPrivateAncestry(root);

  const manifestName=path.basename(filePath);
  required(/^arl-assessment-[a-z0-9-]+\.manifest\.json$/.test(manifestName),
    'unexpected report manifest filename');
  const base=manifestName.slice(0,-'.manifest.json'.length);
  const manifestBytes=readPrivateFile(filePath,MAX_MANIFEST_BYTES);
  const manifest=parseJson(manifestBytes,'manifest');
  required(manifest?.schema===MANIFEST_SCHEMA &&
    manifest.reportSchema===REPORT_SCHEMA &&
    manifest.integrityClaim==='sha256_content_digest_only_not_signature' &&
    manifest.finalDecisionAuthority==='human' &&
    manifest.humanReviewRequired===true &&
    SHA256.test(manifest.bundleSha256 || '') &&
    Array.isArray(manifest.files) && manifest.files.length===2 &&
    base.endsWith('-'+manifest.bundleSha256.slice(0,16)),
    'manifest format, content identifier or authority boundary mismatch');

  const markdownName=base+'.md', jsonName=base+'.json';
  const md=readPrivateFile(path.join(root,markdownName),MAX_REPORT_BYTES);
  const json=readPrivateFile(path.join(root,jsonName),MAX_REPORT_BYTES);
  verifyRow(manifest.files[0],markdownName,'text/markdown; charset=utf-8',md);
  verifyRow(manifest.files[1],jsonName,'application/json',json);

  const report=parseJson(json,'report');
  required(report?.schema===REPORT_SCHEMA &&
    report.available===true && report.projection==='read_only' &&
    report.securityStateChanged===false &&
    report.deploymentDecisionWritten===false &&
    report.humanReviewRequired===true &&
    report.readiness?.humanReviewRequired===true &&
    report.readiness?.finalDecisionAuthority==='human' &&
    report.readiness?.conversationLayerDecisionWritten===false &&
    report.assessment?.projectName===manifest.projectName &&
    report.assessment?.targetRevision===manifest.targetRevision &&
    report.assessment?.systemSnapshotVersion===manifest.systemSnapshotVersion &&
    report.assessment?.controlProfileVersion===manifest.controlProfileVersion &&
    report.readiness?.status===manifest.readinessStatus,
    'report contents disagree with manifest or read-only authority boundary');

  const expectedBase='arl-assessment-'+projectStem(report.assessment.projectName)+
    '-'+revisionStem(report.assessment.targetRevision)+'-'+manifest.bundleSha256.slice(0,16);
  required(base===expectedBase,'report filename disagrees with the versioned target');

  const calculatedBundle=hash(canonicalJson({
    reportSchema: report.schema,
    targetRevision: report.assessment.targetRevision,
    systemSnapshotVersion: report.assessment.systemSnapshotVersion,
    controlProfileVersion: report.assessment.controlProfileVersion,
    readinessStatus: report.readiness.status,
    markdownSha256: hash(md),
    jsonSha256: hash(json)
  }));
  required(calculatedBundle===manifest.bundleSha256,
    'bundle identifier is inconsistent with its Markdown, JSON or snapshot');

  return {
    ...(disclosurePreflight===true ? {
      disclosurePreflight:prepareCustomerReportDisclosurePreflight(report)
    } : {}),
    schema:'arl.customer-report-bundle-integrity-check.v1',
    integrity:'consistent_only',
    authenticity:'not_verified_no_signature',
    reportSecurityVerdict:'not_assessed',
    targetRevision:manifest.targetRevision,
    systemSnapshotVersion:manifest.systemSnapshotVersion,
    bundleSha256:manifest.bundleSha256,
    readinessStatus:manifest.readinessStatus,
    filesChecked:3,
    humanReviewRequired:true,
    deploymentDecisionWritten:false,
    securityStateChanged:false
  };
}
