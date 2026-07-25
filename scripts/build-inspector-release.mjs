import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUNDLE_SCHEMA, INSPECTOR_VERSION, POLICY_CATALOG, POLICY_VERSION } from '../inspector/agent-risk-inspector.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'inspector', 'agent-risk-inspector.mjs');
const destination = path.join(root, 'public', 'downloads', 'agent-risk-inspector.mjs');
const text = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, text);
const digest = crypto.createHash('sha256').update(text).digest('hex');
fs.writeFileSync(`${destination}.sha256`, `${digest}  agent-risk-inspector.mjs\n`);
fs.writeFileSync(path.join(root, 'public', 'inspector-policy.json'), JSON.stringify({ policyVersion: POLICY_VERSION, rules: POLICY_CATALOG }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'public', 'downloads', 'inspector-release.json'), JSON.stringify({
  name: 'AgentRisk Inspector', version: INSPECTOR_VERSION, policyVersion: POLICY_VERSION,
  bundleSchema: BUNDLE_SCHEMA, sha256: digest,
  privacyContract: ['No source code uploaded','No matched secret values uploaded','Read-only static inspection','No exploitation or network probing'],
}, null, 2) + '\n');
console.log(JSON.stringify({ version: INSPECTOR_VERSION, policyVersion: POLICY_VERSION, sha256: digest }, null, 2));
