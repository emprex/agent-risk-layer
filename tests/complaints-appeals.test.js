import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('canonical public complaints and appeals route preserves governance boundaries', () => {
  const home = read('public/index.html');
  const page = read('public/complaints-appeals.html');

  assert.match(home, /href="\/complaints-appeals\.html"/);
  assert.match(page, /support@agentrisklayer\.com/);
  assert.match(page, /must not decide its appeal/i);
  assert.match(page, /must not be investigated solely by that assessor/i);
  assert.match(page, /external competent person or function must be used/i);
  assert.match(page, /does not currently issue accredited certification/i);
  assert.match(page, /not currently UKAS-accredited/i);
  assert.match(page, /does not represent an accredited certification appeal mechanism/i);
  assert.doesNotMatch(page, /guaranteed|accredited appeal service|UKAS-approved/i);
});
