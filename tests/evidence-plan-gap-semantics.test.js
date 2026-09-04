import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence gap endpoint accepts only explicit supported dispositions',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/VALID_STATES/);assert.doesNotMatch(s,/state:\s*'pass'/);assert.doesNotMatch(s,/state:\s*'verified'/);});
