import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated assessment result does not require a share token', () => {
  const result = read('public/result.js');
  assert.doesNotMatch(result, /if \(!id \|\| !token\) return fail\('The assessment link is incomplete\.'\)/);
  assert.match(result, /if \(!id\) return fail\('The assessment link is incomplete\.'\)/);
  assert.match(result, /const assessmentQuery = token \? `\?token=\$\{encodeURIComponent\(token\)\}` : '';/);
  assert.match(result, /api\(`\/api\/assessments\/\$\{encodeURIComponent\(id\)\}\$\{assessmentQuery\}`\)/);
});

test('zero-finding Findings redirect remains valid for signed-in owner context without a token', () => {
  const bootstrap = read('public/control-plane-bootstrap.js');
  assert.match(bootstrap, /if \(token\) resultParams\.set\('token', token\);/);
  assert.match(bootstrap, /location\.replace\(`\/result\.html\?\$\{resultParams\.toString\(\)\}#priorityRisks`\)/);
});
