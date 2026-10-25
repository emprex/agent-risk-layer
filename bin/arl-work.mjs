#!/usr/bin/env node
// Single entrypoint for the human-led local ARL operator. No hosted service.
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  parseExternalManifest, runExternalAssessment
} from '../src/agent/external-agent-assessment.mjs';
import {
  buildExternalOperatorDossier, writeExternalOperatorHtml
} from '../src/agent/external-agent-operator-dashboard.mjs';
import { buildSyntheticExternalOperatorDemo } from '../scripts/demo-external-operator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCEPT = 'I HAVE WRITTEN PERMISSION';
const sha = v => createHash('sha256').update(v).digest('hex');

const safe = async (folder) => {
  const full = path.resolve(folder);
  if (full === path.parse(full).root) throw Error('Refusing filesystem root.');
  await mkdir(full, { mode: 0o700, recursive: true });
  const info = await lstat(full);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077))
    throw Error('Private non-symlinked output directory (0700) required: ' + full);
  return full;
};
const privateRoot = () => path.join(os.homedir(), 'ARL-Assessments');

async function writePrivate(file, data) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(data); } finally { await handle.close(); }
}

function openInBrowser(file) {
  if (process.platform !== 'linux') return;
  const child = spawn('xdg-open', [file], {
    shell: false, stdio: 'ignore', detached: true
  });
  child.once('error', () => {
    console.log('Open the review file manually: ' + file);
  });
  child.once('spawn', () => child.unref());
}

export function buildWizardManifest({ name, owner, endpoint, version, controlIds, requestBody }) {
  const raw = JSON.stringify({
    schema: 'arl.external-agent-manifest.v1',
    target: { name, owner, endpoint, version },
    probes: [{ id: 'PILOT_001', controlIds, body: requestBody }]
  }, null, 2);
  const parsed = parseExternalManifest(raw);
  return { raw, parsed };
}

export function buildLocalObservationRequest({ controlId, observedResult, sourceReference }) {
  const id = String(controlId || '').trim().toUpperCase();
  const observation = String(observedResult || '').trim();
  const source = String(sourceReference || '').trim();
  if (!/^ARL-KB-(?:00[1-9]|0[1-9]\d|10[0-8])$/.test(id) ||
    observation.length < 10 || observation.length > 3000 ||
    source.length < 3 || source.length > 500) {
    throw Error('An exact control ID, specific observation and evidence source reference are required.');
  }
  return 'Record manual evidence ' + JSON.stringify({
    controlId: id,
    result: 'inconclusive',
    observedResult: observation,
    sourceReference: source,
    limitations: 'Operator note only. Not independent validation or a conclusive finding.',
    evidenceChecklist: []
  });
}

export function resolveLocalOperatorAction({ action, acknowledgement = '' }) {
  const ordinary = {
    '1': 'Assess this agent',
    '4': 'Export client preassessment',
    '5': 'Export customer assessment report',
    '6': 'Where are we?'
  };
  if (Object.hasOwn(ordinary, action)) return ordinary[action];
  const sensitive = {
    '7': {
      acknowledgement: 'I AUTHORISE THE BOUNDED LOCAL TEST',
      command: 'I authorise the bounded test'
    },
    '8': {
      acknowledgement: 'I AUTHORISE THE EXACT RETEST',
      command: 'I authorise the exact retest'
    },
    '9': {
      acknowledgement: 'I REAUTHORISE THE EXACT RETEST',
      command: 'I reauthorise the exact retest'
    }
  };
  const command = sensitive[action];
  if (!command) throw Error('Choose a valid ARL assessment action.');
  if (acknowledgement !== command.acknowledgement) {
    throw Error('No explicit authorised test or retest acknowledgement: no test started.');
  }
  return command.command;
}

export function buildWizardRoe({ manifestRaw, operator, reference, fromMs, untilMs }) {
  const parsed = parseExternalManifest(manifestRaw);
  if (!(typeof reference === 'string' && reference.trim().length >= 8 &&
    typeof operator === 'string' && operator.trim().length >= 3 &&
    Number.isFinite(fromMs) && Number.isFinite(untilMs) &&
    untilMs > fromMs && untilMs - fromMs <= 3600000)) {
    throw Error('Written permission reference, operator, and bounded window required.');
  }
  return JSON.stringify({
    schema: 'arl.external-agent-roe.v1',
    manifestSha256: parsed.sha256,
    targetEndpoint: parsed.manifest.target.endpoint,
    owner: parsed.manifest.target.owner,
    operator,
    authorisationReference: reference,
    environment: 'isolated-staging',
    syntheticDataOnly: true,
    notBeforeUtc: new Date(fromMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    notAfterUtc: new Date(untilMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    allowedProbeIds: ['PILOT_001']
  }, null, 2);
}

async function beginCaseFolder(prefix) {
  const root = await safe(privateRoot());
  const folder = path.join(root, prefix + '-' + new Date().toISOString()
    .replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  return safe(folder);
}

function runner(file, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, file), ...args], {
      cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: 'inherit',
      shell: false
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() :
      reject(Error('ARL exited without a completed assessment (exit ' + code + ').')));
  });
}

async function externalWizard(question) {
  console.log('\nCLOSED-SOURCE AGENT · Authorised isolated staging only.');
  console.log('No Meta Muse testing and no unapproved customer targets.');
  const name = await question('Customer agent name: ');
  const owner = await question('System owner organisation: ');
  const endpoint = await question('Approved HTTPS staging endpoint (full URL): ');
  const version = await question('Owner-declared release/build (or unknown): ');
  const control = await question('ARL controls to examine (e.g. ARL-KB-032,ARL-KB-065): ');
  const controlIds = control.split(',').map(s => s.trim().toUpperCase());
  const entered = await question('Exact harmless JSON request body (e.g. {"message":"ARL test"}): ');
  let requestBody;
  try { requestBody = JSON.parse(entered); }
  catch { throw Error('Request must be a valid JSON object.'); }
  const { raw: manifestRaw, parsed } = buildWizardManifest({
    name, owner, endpoint, version, controlIds, requestBody
  });
  const folder = await beginCaseFolder('external');
  const manifestPath = path.join(folder, 'target.json');
  await writePrivate(manifestPath, manifestRaw);
  console.log('\nCase saved: ' + folder);
  console.log('Manifest SHA-256: ' + parsed.sha256);
  console.log('One bounded probe is planned. No network request has been sent.');

  const mode = (await question('Type PLAN (no network) or TEST (send authorised probe): '))
    .trim().toUpperCase();
  if (mode === 'PLAN') {
    console.log('PLAN COMPLETE. No agent was contacted. Review: ' + manifestPath);
    return;
  }
  if (mode !== 'TEST') throw Error('No active test started. Case remains a plan.');
  const operator = await question('Your operator name: ');
  const reference = await question('Written owner authorisation reference (held separately): ');
  console.log('This tool cannot verify your written permission. Check the approved endpoint,');
  console.log('one-probe request body, synthetic-only staging scope and current test time.');
  const consent = await question('To confirm signed scope for the next hour, type ' + ACCEPT + ': ');
  if (consent.trim() !== ACCEPT) throw Error('No authorisation acknowledgement: no request sent.');
  const start = Date.now();
  const roeRaw = buildWizardRoe({
    manifestRaw, operator, reference, fromMs: start - 1000,
    untilMs: start + 59 * 60 * 1000
  });
  const roePath = path.join(folder, 'roe-reference.json');
  await writePrivate(roePath, roeRaw);
  const resultPath = path.join(folder, 'observation.json');
  const reserved = await open(resultPath, 'wx', 0o600);
  let collected;
  try {
    await reserved.writeFile(JSON.stringify({
      schema: 'arl.external-agent-interrupted-run.v1',
      state: 'incomplete_unknown_side_effects', securityVerdict: 'none',
      deploymentDecision: 'hold'
    }) + '\n');
    collected = await runExternalAssessment({
      manifestRaw, roeRaw, operator, acknowledged: true
    });
    const bytes = Buffer.from(JSON.stringify(collected, null, 2) + '\n');
    let offset = 0;
    while (offset < bytes.length) {
      const result = await reserved.write(bytes, offset, bytes.length - offset, offset);
      if (result.bytesWritten < 1) throw Error('Incomplete observation write.');
      offset += result.bytesWritten;
    }
    await reserved.truncate(bytes.length);
    await reserved.sync();
  } finally {
    await reserved.close();
  }
  const dossier = buildExternalOperatorDossier({
    manifestRaw, roeRaw, observationRaw: JSON.stringify(collected)
  });
  const artifact = writeExternalOperatorHtml({ dossier, outputDirectory: folder });
  console.log('\nREAL OBSERVATION COLLECTED. NOT A CONFIRMED SECURITY FINDING.');
  console.log('Private review: ' + artifact.filePath);
  console.log('Controls: 108 · Candidate probes: 1 · Accepted: 0 · Decision: HOLD');
  openInBrowser(artifact.filePath);
}

async function reviewExisting(question) {
  const manifestPath = await question('Existing target.json path: ');
  const roePath = await question('Existing roe-reference.json path: ');
  const observationPath = await question('Existing observation.json path: ');
  for (const input of [manifestPath, roePath, observationPath]) {
    const s = await stat(input);
    if (!s.isFile() || s.size > 262144) throw Error('Missing or oversized input file.');
  }
  const [manifestRaw, roeRaw, observationRaw] = await Promise.all(
    [manifestPath, roePath, observationPath].map(x => readFile(x, 'utf8'))
  );
  const dossier = buildExternalOperatorDossier({
    manifestRaw, roeRaw, observationRaw
  });
  const dir = await beginCaseFolder('review');
  const result = writeExternalOperatorHtml({ dossier, outputDirectory: dir });
  console.log('ARL private review: ' + result.filePath);
  openInBrowser(result.filePath);
}

export async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async prompt => {
    const value = (await rl.question(prompt)).trim();
    if (value.length > 4096) throw Error('Input too long.');
    return value;
  };
  try {
    console.log('\nAGENTRISKLAYER · LOCAL OPERATOR');
    console.log('1. Assess a clean, authorised Git agent (existing full ARL Operator)');
    console.log('2. New authorised external AI-agent staging assessment');
    console.log('3. Open previous external evidence review');
    console.log('4. Explore synthetic operator screen (no network)');
    console.log('5. Check an exported customer report before delivery');
    const mode = await ask('\nChoose 1–5: ');
    if (mode === '1') {
      const target = path.resolve(await ask('Clean, authorised target Git repository folder: '));
      console.log('\nGit-based ARL assessment actions:');
      console.log('1. Run / continue the assessment');
      console.log('2. Open the local review dashboard');
      console.log('3. Record a documented, inconclusive operator observation');
      console.log('4. Export customer preassessment (human-review draft)');
      console.log('5. Export current customer assessment report (if eligible)');
      console.log('6. Where are we? Show the current gate and next required evidence');
      console.log('7. Authorise and run a bounded LOCAL staging test');
      console.log('8. Authorise and run the exact retest');
      console.log('9. Reauthorise the exact retest if ROE has expired');
      const action = await ask('Choose 1–9: ');
      let request;
      if (action === '2') {
        await runner('src/agent/arl-local-assessment-runner.mjs',
          [target], { ARL_OPERATOR_OPEN_DASHBOARD: '1' });
        return;
      } else if (action === '3') {
        const controlId = await ask('Control ID (ARL-KB-###): ');
        const observedResult = await ask('Specific observed fact, minimum 10 characters: ');
        const sourceReference = await ask('Evidence reference or filename: ');
        request = buildLocalObservationRequest({
          controlId, observedResult, sourceReference
        });
      } else if (['7', '8', '9'].includes(action)) {
        console.log('Authorised local staging only. These actions may invoke the approved');
        console.log('local adapter and produce real test side effects in that environment.');
        console.log('Review the exact target, original finding, signed scope and ROE first.');
        console.log('The canonical ARL engine must still independently permit this stage.');
        const phrase = {
          '7': 'I AUTHORISE THE BOUNDED LOCAL TEST',
          '8': 'I AUTHORISE THE EXACT RETEST',
          '9': 'I REAUTHORISE THE EXACT RETEST'
        }[action];
        const acknowledgement = await ask('Type '+phrase+' to continue: ');
        request = resolveLocalOperatorAction({action,acknowledgement});
      } else {
        request = resolveLocalOperatorAction({action});
      }
      await runner('src/agent/arl-local-assessment-runner.mjs',
        [target, request]);
    } else if (mode === '2') {
      await externalWizard(ask);
    } else if (mode === '3') {
      await reviewExisting(ask);
    } else if (mode === '4') {
      const output = await beginCaseFolder('synthetic-demo');
      const result = await buildSyntheticExternalOperatorDemo({
        outputDirectory: output
      });
      console.log('SYNTHETIC DEMO ONLY: ' + result.filePath);
      openInBrowser(result.filePath);
    } else {
      throw Error('Choose a valid option.');
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('ARL STOPPED: ' + error.message);
    process.exitCode = 2;
  });
}
