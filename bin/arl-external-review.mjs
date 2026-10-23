#!/usr/bin/env node
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import {
  buildExternalControlReviewQueue, verifyExternalObservation
} from '../src/agent/external-agent-evidence-review.mjs';

function flagsFrom(args) {
  const flags = new Map();
  const allowed = new Set(['--manifest', '--roe', '--observation', '--out']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || flags.has(flag) ||
      !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Invalid, duplicate or missing-value argument: ' + flag);
    }
    flags.set(flag, args[++i]);
  }
  if (![...['--manifest', '--roe', '--observation']].every(flag => flags.has(flag))) {
    throw new Error('Usage: npm run assess:external:review -- --manifest target.json --roe roe.json --observation observation.json [--out private/review-queue.json]');
  }
  return flags;
}

async function main() {
  const flags = flagsFrom(process.argv.slice(2));
  const [manifestRaw, roeRaw, observationRaw] = await Promise.all(
    ['--manifest', '--roe', '--observation'].map(flag =>
      readFile(flags.get(flag), 'utf8'))
  );
  const input = { manifestRaw, roeRaw, observationRaw };
  const integrity = verifyExternalObservation(input);
  const outputPath = flags.get('--out');
  if (!outputPath) {
    console.log(JSON.stringify(integrity, null, 2));
    return;
  }
  const queue = buildExternalControlReviewQueue(input);
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const file = await open(absolute, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(queue, null, 2) + '\n');
  } finally {
    await file.close();
  }
  console.log(JSON.stringify({
    output: absolute, controlsTotal: queue.controlsTotal,
    mappedControlCount: queue.mappedControlCount,
    consistentOnly: queue.integrity, evidenceAccepted: false,
    databaseModified: false, deploymentDecision: 'hold'
  }, null, 2));
}

main().catch(error => {
  console.error('ARL EXTERNAL EVIDENCE REVIEW BLOCKED: ' + String(error.message));
  process.exitCode = 2;
});
