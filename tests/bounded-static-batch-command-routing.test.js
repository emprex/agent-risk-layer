import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('persist batch routing matches the actual CLI request and rejects lookalikes', () => {
  const src = readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');
  const line=src.split('\n').find(x=>x.includes('if (/^Persist assessment static batch'));
  assert.ok(line, 'dedicated batch command route must exist');
  const literal=line.match(/if \((\/\^Persist assessment static batch.*?\/[a-z]*)\.test\(request\.trim\(\)\)\)/);
  assert.ok(literal,'route should be a direct regular-expression test');
  const expression = literal[1];
  const flags=expression.slice(expression.lastIndexOf('/')+1);
  const pattern=expression.slice(1,expression.lastIndexOf('/'));
  const route=new RegExp(pattern,flags);
  assert.equal(route.test('Persist assessment static batch 1'),true);
  assert.equal(route.test('Persist assessment static batch 5'),true);
  assert.equal(route.test('Persist assessment static batch 1.'),true);
  assert.equal(route.test('Persist assessment static batching 1'),false);
  assert.equal(route.test('Inspect frozen target'),false);
});
