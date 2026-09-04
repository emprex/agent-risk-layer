import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('API records exact evidence-gap state',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/const resolution=\{state,rationale,reviewerUserId:user\.id,recordedAt\}/);});
