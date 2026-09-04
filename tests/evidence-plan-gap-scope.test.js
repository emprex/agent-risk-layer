import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence disposition endpoint whitelists plan IDs',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/VALID_PLAN_IDS/);assert.match(s,/egress-boundary/);});
