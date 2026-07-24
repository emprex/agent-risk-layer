import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUNDLE_SCHEMA, POLICY_VERSION, REDTEAM_VERSION, TEST_CATALOG } from '../redteam/agent-risk-redteam.mjs';

const root = path.resolve(import.meta.dirname, '..');
const downloads = path.join(root, 'public', 'downloads');
fs.mkdirSync(downloads, { recursive: true });

function publish(sourceName, destinationName) {
  const source = path.join(root, 'redteam', sourceName);
  const destination = path.join(downloads, destinationName);
  const text = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(destination, text);
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(`${destination}.sha256`, `${digest}  ${destinationName}\n`);
  return digest;
}

const runnerDigest = publish('agent-risk-redteam.mjs', 'agent-risk-redteam.mjs');
const adapterDigest = publish('adapter-example.mjs', 'agent-risk-redteam-adapter-example.mjs');
const ciDigest = publish('agentrisk-redteam-ci.example.yml', 'agentrisk-redteam-ci.example.yml');
fs.writeFileSync(path.join(root, 'public', 'redteam-policy.json'), JSON.stringify({ policyVersion: POLICY_VERSION, cases: TEST_CATALOG }, null, 2) + '\n');
fs.writeFileSync(path.join(downloads, 'redteam-release.json'), JSON.stringify({
  name: 'AgentRisk Red Team Runner', version: REDTEAM_VERSION, policyVersion: POLICY_VERSION,
  bundleSchema: BUNDLE_SCHEMA, runnerSha256: runnerDigest, adapterExampleSha256: adapterDigest, ciExampleSha256: ciDigest,
  safetyContract: ['Explicit authorisation required','Local/test/staging only','Synthetic canaries only','Dry-run tools only','No raw transcript upload','No production target mode'],
}, null, 2) + '\n');
console.log(JSON.stringify({ version: REDTEAM_VERSION, policyVersion: POLICY_VERSION, runnerSha256: runnerDigest, adapterExampleSha256: adapterDigest, ciExampleSha256: ciDigest }, null, 2));
