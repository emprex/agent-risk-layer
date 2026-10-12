import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('local CLI routes the real administrative KB-007 command to its dedicated handler', () => {
  const source = readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');
  const matched = source.match(/const concludeInconclusive = (\/\^Document inconclusive review .*?\$\/)\.exec\(request\.trim\(\)\)/);
  assert.ok(matched, 'inconclusive command dispatch must exist');
  const pattern = runInNewContext(matched[1]);
  assert.deepEqual(
    Array.from(pattern.exec('Document inconclusive review ARL-KB-007') || []),
    ['Document inconclusive review ARL-KB-007', 'ARL-KB-007']
  );
  assert.equal(pattern.test('Document inconclusive review ARL-KB-008'), true);
  assert.equal(pattern.test('Document inconclusive review ARL-KB-xyz'), false);
});
