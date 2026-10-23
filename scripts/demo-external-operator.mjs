#!/usr/bin/env node
// Dedicated safe UI demo: NO customer inputs, NO DNS, NO HTTP and NO database.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExternalAssessment } from '../src/agent/external-agent-assessment.mjs';
import {
  buildExternalOperatorDossier,
  writeExternalOperatorHtml
} from '../src/agent/external-agent-operator-dashboard.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

export async function buildSyntheticExternalOperatorDemo({ outputDirectory, nowMs = Date.now() }) {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) {
    throw new Error('Explicit private --out-dir required.');
  }
  const manifestRaw = JSON.stringify({
    schema: 'arl.external-agent-manifest.v1',
    target: {
      name: 'SYNTHETIC DEMO — No Customer',
      owner: 'Fictional synthetic staging owner',
      endpoint: 'https://synthetic-demo.example.org/v1/agent',
      version: 'fictional-demo-build-1'
    },
    probes: [
      {
        id: 'DEMO_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'],
        body: { message: 'Synthetic benign demo permission-check prompt' }
      },
      {
        id: 'DEMO_002', controlIds: ['ARL-KB-053', 'ARL-KB-090'],
        body: { message: 'Synthetic benign demo denied action' }
      }
    ]
  });
  const roeRaw = JSON.stringify({
    schema: 'arl.external-agent-roe.v1',
    manifestSha256: sha(manifestRaw),
    targetEndpoint: 'https://synthetic-demo.example.org/v1/agent',
    owner: 'Fictional synthetic staging owner',
    operator: 'ARL Synthetic Preview',
    authorisationReference: 'SYNTHETIC_ONLY_NO_REAL_OWNER',
    environment: 'isolated-staging', syntheticDataOnly: true,
    notBeforeUtc: new Date(nowMs - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    notAfterUtc: new Date(nowMs + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    allowedProbeIds: ['DEMO_001', 'DEMO_002']
  });
  let simulatedCalls = 0;
  const observation = await runExternalAssessment({
    manifestRaw, roeRaw,
    operator: 'ARL Synthetic Preview',
    acknowledged: true,
    now: () => nowMs,
    send: async ({ bodyBytes }) => {
      simulatedCalls += 1;
      const body = JSON.parse(bodyBytes);
      return body.message.includes('denied action')
        ? { status: 403, body: Buffer.from('{"synthetic":"denied"}') }
        : { status: 200, body: Buffer.from('{"synthetic":"processed"}') };
    }
  });
  if (simulatedCalls !== 2) {
    throw new Error('Synthetic demo must simulate exactly two in-memory probes.');
  }
  const dossier = buildExternalOperatorDossier({
    manifestRaw, roeRaw,
    observationRaw: JSON.stringify(observation),
    syntheticDemo: true
  });
  const artifact = writeExternalOperatorHtml({ dossier, outputDirectory });
  return {
    schema: 'arl.external-agent-synthetic-demo.v1',
    ...artifact,
    syntheticDemo: true,
    simulatedCalls,
    liveNetworkCalls: 0,
    databaseModified: false,
    controlsTotal: dossier.controlsTotal,
    mappedControls: dossier.candidateControlCount,
    evidenceAccepted: false,
    confirmedFindings: 0,
    deploymentDecision: 'hold'
  };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--out-dir' || !args[1]) {
    throw new Error('Usage: npm run demo:external -- --out-dir "$HOME/arl-private-external-review"');
  }
  console.log(JSON.stringify(
    await buildSyntheticExternalOperatorDemo({ outputDirectory: args[1] }),
    null, 2
  ));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error('ARL SYNTHETIC DEMO BLOCKED: ' + error.message);
    process.exitCode = 2;
  });
}
