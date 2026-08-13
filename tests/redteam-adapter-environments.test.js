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

test('exact retests can reuse the same active Rules of Engagement instead of creating a new record', () => {
  const source = read('public/redteam.js');

  assert.match(source, /id="authorisationChoice"/);
  assert.match(source, /Reuse the same active authorisation for a failed baseline and its exact retest/);
  assert.match(source, /authorisations\.find\(a=>a\.id===existingId&&a\.status==='active'\)/);
  assert.match(source, /Using existing Rules of Engagement/);
  assert.match(source, /authorisationId:authorisation\?\.id\|\|null/);
});

test('reused Rules of Engagement fail closed on expiry and known endpoint-origin mismatch', () => {
  const source = read('public/redteam.js');

  assert.match(source, /Date\.parse\(authorisation\.windowEnd\)<=Date\.now\(\)/);
  assert.match(source, /adapter endpoint origin does not match the selected Rules of Engagement authorisation/i);
  assert.match(source, /parsedEndpoint\.origin!==authorisation\.endpointOrigin/);
});

test('authorisation and campaign history expose provenance IDs needed by the evidence-binding workflow', () => {
  const source = read('public/redteam.js');

  assert.match(source, /escapeHtml\(a\.environment\)/);
  assert.match(source, /a\.endpointOrigin/);
  assert.match(source, /escapeHtml\(a\.endpointOrigin\)/);
  assert.match(source, /escapeHtml\(a\.id\)/);
  assert.match(source, /runId=escapeHtml\(x\?\.id\|\|'unknown'\)/);
  assert.match(source, /Run ID \$\{runId\}/);
});

test('Red Team UI can recover a completed signed adapter bundle without rerunning the target', () => {
  const source = read('public/redteam.js');

  assert.match(source, /Completed evidence recovery/);
  assert.match(source, /id="recoveryBundle"/);
  assert.match(source, /\/api\/redteam\/recovery-tokens/);
  assert.match(source, /Upload completed signed bundle/);
  assert.match(source, /does not rerun the target or extend the testing window/);
  assert.match(source, /no target rerun occurred/);
});
