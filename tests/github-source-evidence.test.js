import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFrozenGithubTarget } from '../src/github-source-inspection.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('frozen GitHub target parser requires owner/repository and full SHA', () => {
  const assessment = {
    answers_json: JSON.stringify({
      __system_description: `BossConsole\n\n[ARL_TARGET]\nRepository: risa-labs-inc/BossConsole\nRevision: 6bf9c46203f6efe1c83c869b0de8ecff0fc4b517`,
    }),
  };
  assert.deepEqual(parseFrozenGithubTarget(assessment), {
    repository: 'risa-labs-inc/BossConsole',
    revision: '6bf9c46203f6efe1c83c869b0de8ecff0fc4b517',
  });
  assert.equal(parseFrozenGithubTarget({ answers_json: JSON.stringify({ __system_description: '[ARL_TARGET]\nRepository: owner/repo\nRevision: main' }) }), null);
});

test('Evidence page offers GitHub source first and local source as fallback', () => {
  const js = read('public/inspector-frozen-target.js');
  assert.match(js, /GitHub source/);
  assert.match(js, /Inspect frozen GitHub revision/);
  assert.match(js, /Local source/);
  assert.match(js, /Use local Inspector/);
  assert.match(js, /\/api\/inspector\/github/);
  assert.match(js, /static source evidence, not runtime proof/i);
});

test('bounded evidence outcome is not shown before source inspection exists', () => {
  const js = read('public/inspector-evidence-outcomes.js');
  assert.match(js, /if \(!inspections\.length\)/);
  assert.match(js, /insert\(''\)/);
  assert.match(js, /After source evidence/);
});

test('server exposes authenticated hosted GitHub source-inspection route', () => {
  const server = read('server.js');
  assert.match(server, /runFrozenGithubSourceInspection/);
  assert.match(server, /url\.pathname === '\/api\/inspector\/github'/);
  assert.match(server, /github-source-inspection/);
});

test('hosted GitHub inspection records exact source binding separately from runtime evidence', () => {
  const source = read('src/github-source-inspection.js');
  assert.match(source, /server-observed-github-static-evidence/);
  assert.match(source, /sourceBinding/);
  assert.match(source, /repository:\s*target\.repository/);
  assert.match(source, /revision:\s*target\.revision/);
  assert.match(source, /not runtime evidence/i);
  assert.match(source, /repo\.private/);
  assert.match(source, /resolved !== target\.revision/);
});
