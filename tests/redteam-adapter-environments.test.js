import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Red Team UI supports authorised local, test and staging adapters', () => {
  const source = read('public/redteam.js');

  assert.match(source, /value="adapter"/);
  assert.match(source, /id="adapterEnvironment"/);
  assert.match(source, /value="local" selected/);
  assert.match(source, /value="test"/);
  assert.match(source, /value="staging"/);
  assert.match(source, /--environment \$\{environment\}/);
  assert.match(source, /mode:mode==='adapter'\?'staging':'simulation'/);
  assert.doesNotMatch(source, /environment:'staging',authorityBasis/);
});

test('Red Team UI mirrors runner endpoint safety rules', () => {
  const source = read('public/redteam.js');

  assert.match(source, /Local adapter mode may target localhost only/);
  assert.match(source, /Remote test and staging adapters must use HTTPS/);
  assert.match(source, /\['localhost','127\.0\.0\.1','::1'\]/);
  assert.match(source, /url\.protocol!=='https:'&&!\(local&&url\.protocol==='http:'\)/);
});

test('Red Team UI can generate an exact-case baseline or retest command', () => {
  const source = read('public/redteam.js');

  assert.match(source, /Specific Red Team case \(optional\)/);
  assert.match(source, /RT-PI-008/);
  assert.match(source, /--case \$\{shellQuote\(caseId\)\} --no-mutation --adaptive-rounds 1/);
  assert.match(source, /Leave blank to run the full catalogue/);
});

test('adapter authorisation history surfaces its environment and bound origin when present', () => {
  const source = read('public/redteam.js');

  assert.match(source, /escapeHtml\(a\.environment\)/);
  assert.match(source, /a\.endpointOrigin/);
  assert.match(source, /escapeHtml\(a\.endpointOrigin\)/);
});
