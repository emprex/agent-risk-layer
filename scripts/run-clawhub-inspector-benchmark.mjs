#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { scanRepository, INSPECTOR_VERSION, POLICY_VERSION } from '../inspector/agent-risk-inspector.mjs';
import {
  CLAWHUB_DATASET,
  CLAWHUB_FROZEN_FILES,
  CLAWHUB_SOURCE_REVISION,
  assertBenchmarkPurposeAllowed,
  projectClawHubRecord,
} from '../src/external-security-intelligence-core.js';
import {
  benchmarkRelevantRuleIds,
  externalSignalLabels,
  mappedSignalsForRow,
  summariseClawHubBenchmark,
} from '../src/clawhub-inspector-benchmark.js';

const MAX_BUNDLE_FILES = 300;
const MAX_BUNDLE_FILE_BYTES = 2_000_000;
const MAX_SKILL_MD_BYTES = 2_000_000;

function usage(error) {
  if (error) console.error(`Error: ${error}`);
  console.error(`Usage:\n  node scripts/run-clawhub-inspector-benchmark.mjs \\\n    --file /private/clawhub/eval_holdout.jsonl \\\n    --split eval_holdout \\\n    --purpose evaluation \\\n    [--out validation/clawhub-inspector-benchmark.json]\n\nThis runner is read-only with respect to the source corpus. It reconstructs sanitized rows in temporary directories, never executes corpus code, excludes VirusTotal fields from analysis, and deletes temporary artifacts after each scan.`);
  process.exit(error ? 2 : 0);
}

function parseArgs(argv) {
  const options = { file: '', split: '', purpose: '', out: 'validation/clawhub-inspector-benchmark.json' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') options.file = argv[++index];
    else if (arg === '--split') options.split = argv[++index];
    else if (arg === '--purpose') options.purpose = argv[++index];
    else if (arg === '--out') options.out = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown argument ${arg}`);
  }
  if (!options.file) usage('--file is required.');
  if (!options.split) usage('--split is required.');
  if (!options.purpose) usage('--purpose is required.');
  assertBenchmarkPurposeAllowed(options.split, options.purpose);
  if (!CLAWHUB_FROZEN_FILES[`${options.split}.jsonl`]) usage(`Unsupported frozen split ${options.split}.`);
  return options;
}

function safeRelativePath(value) {
  const cleaned = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0')) return null;
  const parts = cleaned.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (cleaned.length > 500) return null;
  return cleaned;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const bytes = fs.readFileSync(filePath);
  hash.update(bytes);
  return hash.digest('hex');
}

async function materialiseRow(root, raw) {
  const projected = projectClawHubRecord(raw);
  const rowDir = await fsPromises.mkdtemp(path.join(root, 'row-'));
  let bundleFilesWritten = 0;
  let bundleFilesSkipped = 0;
  const skillMd = String(raw.skill_md_content || '');
  if (Buffer.byteLength(skillMd, 'utf8') <= MAX_SKILL_MD_BYTES) {
    await fsPromises.writeFile(path.join(rowDir, 'SKILL.md'), skillMd, { encoding: 'utf8', mode: 0o600 });
  } else {
    bundleFilesSkipped += 1;
  }

  for (const item of Array.isArray(raw.skill_bundle_content) ? raw.skill_bundle_content.slice(0, MAX_BUNDLE_FILES) : []) {
    const relative = safeRelativePath(item?.path);
    const content = typeof item?.content === 'string' ? item.content : '';
    if (!relative || Buffer.byteLength(content, 'utf8') > MAX_BUNDLE_FILE_BYTES) {
      bundleFilesSkipped += 1;
      continue;
    }
    const destination = path.resolve(rowDir, relative);
    if (!destination.startsWith(`${path.resolve(rowDir)}${path.sep}`)) {
      bundleFilesSkipped += 1;
      continue;
    }
    await fsPromises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fsPromises.writeFile(destination, content, { encoding: 'utf8', mode: 0o600 });
    bundleFilesWritten += 1;
  }
  if (Array.isArray(raw.skill_bundle_content) && raw.skill_bundle_content.length > MAX_BUNDLE_FILES) {
    bundleFilesSkipped += raw.skill_bundle_content.length - MAX_BUNDLE_FILES;
  }
  return { rowDir, projected, bundleFilesWritten, bundleFilesSkipped };
}

const options = parseArgs(process.argv.slice(2));
const expected = CLAWHUB_FROZEN_FILES[`${options.split}.jsonl`];
const sourcePath = path.resolve(options.file);
const sourceSha256 = sha256File(sourcePath);
if (sourceSha256 !== expected.sha256) {
  throw new Error(`${path.basename(sourcePath)} SHA-256 ${sourceSha256} does not match pinned ${expected.sha256}.`);
}

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'arl-clawhub-benchmark-'));
const stream = fs.createReadStream(sourcePath, { encoding: 'utf8' });
const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
const records = [];
let rows = 0;
let bundleFilesWritten = 0;
let bundleFilesSkipped = 0;

try {
  for await (const line of lines) {
    if (!line.trim()) continue;
    rows += 1;
    let raw;
    try { raw = JSON.parse(line); }
    catch { throw new Error(`Invalid JSON on source row ${rows}.`); }
    if (raw.split !== options.split) throw new Error(`Source row ${rows} has split ${raw.split}; expected ${options.split}.`);
    let rowDir = null;
    try {
      const materialised = await materialiseRow(tempRoot, raw);
      rowDir = materialised.rowDir;
      bundleFilesWritten += materialised.bundleFilesWritten;
      bundleFilesSkipped += materialised.bundleFilesSkipped;
      const bundle = await scanRepository(rowDir, {
        authorised: true,
        environment: 'test',
        includePaths: false,
        limits: { maxFiles: 500, maxReadableFileBytes: 2_000_000, maxTotalReadBytes: 8_000_000, maxFindings: 100 },
      });
      const arlRuleIds = benchmarkRelevantRuleIds(bundle.findings);
      records.push({
        external: externalSignalLabels(raw),
        mappedSignals: mappedSignalsForRow(raw),
        arlRuleIds,
        arlPositive: arlRuleIds.length > 0,
      });
    } catch (error) {
      records.push({ error: String(error?.message || error).slice(0, 500) });
    } finally {
      if (rowDir) await fsPromises.rm(rowDir, { recursive: true, force: true });
    }
  }
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

if (rows !== expected.rows) {
  throw new Error(`Source row count ${rows} does not match pinned ${expected.rows}.`);
}

const report = summariseClawHubBenchmark(records, {
  corpus: CLAWHUB_DATASET,
  sourceRevision: CLAWHUB_SOURCE_REVISION,
  sourceFileSha256: sourceSha256,
  split: options.split,
  inspectorVersion: INSPECTOR_VERSION,
  inspectorPolicyVersion: POLICY_VERSION,
});
report.materialisation = { bundleFilesWritten, bundleFilesSkipped, codeExecuted: false, networkProbing: false, virusTotalFieldsUsed: false };
report.claimBoundary = 'This report measures concordance between AgentRisk Inspector findings and external silver-standard signals on sanitized reconstructed skill artifacts. It is not an accuracy, prevalence, certification or superiority claim.';

const output = path.resolve(options.out);
await fsPromises.mkdir(path.dirname(output), { recursive: true });
await fsPromises.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: report.scanErrors === 0,
  schema: report.schema,
  sourceRevision: report.sourceRevision,
  split: report.split,
  rowsEvaluated: report.rowsEvaluated,
  scanErrors: report.scanErrors,
  arlPositiveRows: report.arlPositiveRows,
  output,
}, null, 2));
if (report.scanErrors > 0) process.exitCode = 1;
