import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'ARL_TOOLCHAIN_VERSIONS.json');
const destination = path.join(
  root,
  'public',
  'downloads',
  'arl-toolchain-release.json'
);

const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
if (parsed?.schema !== 'arl.toolchain-release.v1') {
  throw new Error('Invalid ARL toolchain version manifest.');
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(parsed, null, 2) + '\n');
console.log(JSON.stringify(parsed, null, 2));
