#!/usr/bin/env node
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import {
  parseExternalManifest, runExternalAssessment
} from '../src/agent/external-agent-assessment.mjs';

function usage() {
  return [
    'ARL external-agent evidence collector (bounded staging only)',
    'PLAN:    npm run assess:external -- --manifest target.json --plan',
    'EXECUTE: npm run assess:external -- --manifest target.json --roe approval.json --operator "Name" --out private/observations.json --execute --ack-authorised',
    'No credentials, no redirects, no automatic findings; execution requires written scope.'
  ].join('\n');
}

async function main(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--manifest', '--roe', '--operator', '--out', '--plan', '--execute', '--ack-authorised'].includes(arg) || flags.has(arg)) {
      throw new Error('Unsupported or duplicate flag: ' + arg);
    }
    if (['--plan', '--execute', '--ack-authorised'].includes(arg)) flags.set(arg, true);
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      flags.set(arg, args[++i]);
    }
  }
  if (!flags.get('--manifest') || Boolean(flags.get('--plan')) === Boolean(flags.get('--execute'))) {
    throw new Error(usage());
  }
  const raw = await readFile(flags.get('--manifest'), 'utf8');
  const parsed = parseExternalManifest(raw);
  if (flags.get('--plan')) {
    if (flags.size !== 2) throw new Error('Planning accepts only --manifest and --plan.');
    console.log(JSON.stringify({
      schema: 'arl.external-agent-plan.v1',
      target: parsed.manifest.target.name, declaredVersion: parsed.manifest.target.version,
      endpoint: parsed.manifest.target.endpoint, manifestSha256: parsed.sha256,
      probes: parsed.manifest.probes.map(p => ({ id: p.id, controlIds: p.controlIds })),
      networkExecuted: false, evidenceStatus: 'not_collected', securityVerdict: 'none'
    }, null, 2));
    return;
  }
  if (flags.size !== 6 || !flags.get('--ack-authorised') || !flags.get('--roe') ||
    !flags.get('--operator') || !flags.get('--out')) throw new Error(usage());
  const roeRaw = await readFile(flags.get('--roe'), 'utf8');
  const output = path.resolve(flags.get('--out'));
  const report = await runExternalAssessment({
    manifestRaw: raw, roeRaw, operator: flags.get('--operator'), acknowledged: true
  });
  // Immutable private artifact; never overwrite existing reports or follow a file symlink.
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(report, null, 2) + '\n'); }
  finally { await file.close(); }
  console.log(JSON.stringify({
    output, observationCount: report.observationCount,
    evidenceStatus: report.evidenceStatus, securityVerdict: report.securityVerdict,
    deploymentDecision: report.deploymentDecision
  }, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error('ARL EXTERNAL ASSESSMENT BLOCKED: ' + error.message);
  process.exitCode = 2;
});
