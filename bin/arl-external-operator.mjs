#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  buildExternalOperatorDossier,
  writeExternalOperatorHtml
} from '../src/agent/external-agent-operator-dashboard.mjs';

function argumentsFrom(argv) {
  const flags = new Map();
  const expected = new Set(['--manifest','--roe','--observation','--out-dir']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!expected.has(flag) || flags.has(flag) ||
      !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Unknown, duplicate or missing-value flag: ' + flag);
    }
    flags.set(flag, argv[++i]);
  }
  if (flags.size !== 4) throw new Error(
    'Usage: npm run assess:external:operator -- ' +
    '--manifest /private/target.json --roe /private/roe.json ' +
    '--observation /private/observation.json --out-dir /private/arl-reports'
  );
  return flags;
}

async function main(argv) {
  const flags = argumentsFrom(argv);
  const [manifestRaw, roeRaw, observationRaw] = await Promise.all(
    ['--manifest','--roe','--observation'].map(flag =>
      readFile(flags.get(flag), 'utf8'))
  );
  const dossier = buildExternalOperatorDossier({
    manifestRaw, roeRaw, observationRaw
  });
  const result = writeExternalOperatorHtml({
    dossier, outputDirectory: flags.get('--out-dir')
  });
  console.log(JSON.stringify({
    schema: 'arl.external-agent-operator-export.v1',
    ...result,
    controlsTotal: dossier.controlsTotal,
    candidateControlCount: dossier.candidateControlCount,
    probes: dossier.candidateProbeCount,
    evidenceAccepted: false,
    humanReviewRequired: true,
    displayInstruction: 'Open the private HTML file locally. It never connects to ARL or the target.'
  }, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error('ARL EXTERNAL OPERATOR BLOCKED: ' + error.message);
  process.exitCode = 2;
});
