#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import {
  CLAWHUB_CORPUS_ID,
  CLAWHUB_DATASET,
  CLAWHUB_SOURCE_REVISION,
  aggregateClawHubRecord,
  assertMitLicenseText,
  assertPinnedClawHubRevision,
  projectClawHubRecord,
} from '../src/external-security-intelligence-core.js';

const MAX_JSONL_LINE_BYTES = 16 * 1024 * 1024;
const EXPECTED_PAPER_ROWS = 67453;

function usage(error) {
  if (error) console.error(`Error: ${error}`);
  console.error(`Usage:\n  node --env-file-if-exists=.env scripts/import-clawhub-security-signals.mjs \\\n    --file /private/path/train.jsonl [--file /private/path/validation.jsonl ...] \\\n    --license-file /private/path/LICENSE \\\n    --revision ${CLAWHUB_SOURCE_REVISION} \\\n    [--expected-rows ${EXPECTED_PAPER_ROWS}] [--dry-run]\n\nThe importer is offline-only. It never fetches Hugging Face or VirusTotal. Raw SKILL/bundle content and all VirusTotal-derived fields are discarded before persistence.`);
  process.exit(error ? 2 : 0);
}

function parseArgs(argv) {
  const options = { files: [], revision: '', licenseFile: '', expectedRows: EXPECTED_PAPER_ROWS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') options.files.push(argv[++i]);
    else if (arg === '--license-file') options.licenseFile = argv[++i];
    else if (arg === '--revision') options.revision = argv[++i];
    else if (arg === '--expected-rows') options.expectedRows = Number(argv[++i]);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown argument ${arg}`);
  }
  if (!options.files.length) usage('At least one --file is required.');
  if (!options.licenseFile) usage('--license-file is required so the exact upstream licence is captured by digest.');
  if (!Number.isInteger(options.expectedRows) || options.expectedRows <= 0) usage('--expected-rows must be a positive integer.');
  options.revision = assertPinnedClawHubRevision(options.revision);
  if (options.revision !== CLAWHUB_SOURCE_REVISION) usage('This importer supports the pinned frozen paper snapshot only. Review code and third-party terms before changing revision.');
  return options;
}

function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function combineFileDigests(fileDigests) {
  const canonical = fileDigests
    .map(({ name, sha256 }) => `${name}\t${sha256}`)
    .sort()
    .join('\n');
  return sha256Text(canonical);
}

async function scanFile(filePath, onRecord) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const tap = new PassThrough();
  input.on('data', (chunk) => hash.update(chunk));
  input.pipe(tap);
  const rl = readline.createInterface({ input: tap, crlfDelay: Infinity });
  let rows = 0;
  let rawFieldsStripped = 0;
  let virusTotalFieldsStripped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows += 1;
    if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
      throw new Error(`${path.basename(filePath)} row ${rows} exceeds the ${MAX_JSONL_LINE_BYTES} byte safety limit.`);
    }
    let parsed;
    try { parsed = JSON.parse(line); }
    catch { throw new Error(`${path.basename(filePath)} row ${rows} is not valid JSON.`); }
    const projected = projectClawHubRecord(parsed);
    rawFieldsStripped += projected.strippedRawContentFieldCount;
    virusTotalFieldsStripped += projected.strippedVirusTotalFieldCount;
    await onRecord(parsed, projected);
  }
  return {
    rows,
    sha256: hash.digest('hex'),
    rawFieldsStripped,
    virusTotalFieldsStripped,
  };
}

const options = parseArgs(process.argv.slice(2));
const licenceText = await fsPromises.readFile(options.licenseFile, 'utf8');
if (!licenceText.trim()) usage('The supplied licence file is empty.');
assertMitLicenseText(licenceText);
const licenseTextSha256 = sha256Text(licenceText);
const aggregateMap = new Map();
const fileDigests = [];
const splitCounts = new Map();
let totalRows = 0;
let strippedRawFields = 0;
let strippedVirusTotalFields = 0;
let persistence = null;

if (!options.dryRun) {
  const { initialiseDatabase } = await import('../src/db.js');
  await initialiseDatabase();
  persistence = await import('../src/external-security-intelligence.js');
}

try {
  for (const file of options.files) {
    const absolute = path.resolve(file);
    const result = await scanFile(absolute, async (_raw, projected) => {
      totalRows += 1;
      splitCounts.set(projected.split, (splitCounts.get(projected.split) || 0) + 1);
      aggregateClawHubRecord(projected, aggregateMap);
    });
    strippedRawFields += result.rawFieldsStripped;
    strippedVirusTotalFields += result.virusTotalFieldsStripped;
    fileDigests.push({ name: path.basename(absolute), sha256: result.sha256 });
  }

  if (totalRows !== options.expectedRows) {
    throw new Error(`Corpus row count ${totalRows} does not match expected frozen-snapshot count ${options.expectedRows}. Review the pinned files/revision before importing.`);
  }

  const importFileSha256 = combineFileDigests(fileDigests);
  const manifest = {
    corpusId: CLAWHUB_CORPUS_ID,
    dataset: CLAWHUB_DATASET,
    sourceRevision: options.revision,
    licenseSpdx: 'MIT',
    licenseTextSha256,
    importFileSha256,
    rowCount: totalRows,
    splitCounts: Object.fromEntries([...splitCounts.entries()].sort()),
    excludedFromPersistence: ['skill_md_content', 'skill_bundle_content', 'clawscan_summary', 'clawscan_context', 'virustotal_*'],
    virusTotalCustomerVisible: false,
    rawContentRetained: false,
  };
  const manifestSha256 = sha256Text(JSON.stringify(manifest));

  if (persistence) {
    await persistence.registerExternalCorpus({
      id: CLAWHUB_CORPUS_ID,
      sourceName: 'OpenClaw',
      datasetName: CLAWHUB_DATASET,
      sourceUrl: 'https://huggingface.co/datasets/OpenClaw/clawhub-security-signals',
      sourceRevision: options.revision,
      licenseSpdx: 'MIT',
      licenseText: licenceText,
      manifestSha256,
      importFileSha256,
      notes: 'Frozen paper snapshot. Raw skill/bundle content and VirusTotal-derived fields are not retained in AgentRiskLayer production tables.',
    });
    // Persist only after the complete source file set, exact licence digest and manifest digest are known.
    totalRows = 0;
    aggregateMap.clear();
    splitCounts.clear();
    for (const file of options.files) {
      let batch = [];
      await scanFile(path.resolve(file), async (raw, projected) => {
        totalRows += 1;
        splitCounts.set(projected.split, (splitCounts.get(projected.split) || 0) + 1);
        aggregateClawHubRecord(projected, aggregateMap);
        batch.push(raw);
        if (batch.length >= 250) {
          await persistence.upsertExternalIntelligenceBatch(CLAWHUB_CORPUS_ID, batch);
          batch = [];
        }
      });
      if (batch.length) await persistence.upsertExternalIntelligenceBatch(CLAWHUB_CORPUS_ID, batch);
    }
    await persistence.replaceExternalIntelligenceAggregates(CLAWHUB_CORPUS_ID, aggregateMap);
    await persistence.finaliseExternalCorpusImport(CLAWHUB_CORPUS_ID, totalRows);
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: options.dryRun,
    corpusId: CLAWHUB_CORPUS_ID,
    sourceRevision: options.revision,
    rows: totalRows,
    splitCounts: Object.fromEntries([...splitCounts.entries()].sort()),
    licenseTextSha256,
    rawContentRetained: false,
    virusTotalCustomerVisible: false,
    strippedRawFieldOccurrences: strippedRawFields,
    strippedVirusTotalFieldOccurrences: strippedVirusTotalFields,
  }, null, 2));
} catch (error) {
  if (persistence) await persistence.markExternalCorpusImportFailed(CLAWHUB_CORPUS_ID).catch(() => {});
  console.error(`ClawHub intelligence import failed: ${error.message}`);
  process.exitCode = 1;
}
