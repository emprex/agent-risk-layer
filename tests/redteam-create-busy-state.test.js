import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('red-team page releases create action once a command is rendered', () => {
  const html = read('public/redteam.html');
  const js = read('public/redteam-busy-release.js');

  assert.match(html, /redteam-busy-release\.js/);
  assert.match(js, /#campaignCommand/);
  assert.match(js, /button\.disabled = false/);
  assert.match(js, /Create bounded evidence command/);
  assert.match(js, /Create exact retest command/);
  assert.match(js, /Create controlled campaign command/);
});
