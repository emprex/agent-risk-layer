import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence dispositions are owner-authenticated and CSRF protected',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/getUserFromRequest/);assert.match(s,/row\.user_id!==user\.id/);assert.match(s,/verifyCsrf/);});
