import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence gap writes a distinct audit event',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/evidence_plan_gap_recorded/);assert.match(s,/assessmentId,planId,state,recordedAt/);});
