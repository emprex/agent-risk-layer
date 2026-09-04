import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence gap persistence keeps reviewer and timestamp',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/reviewerUserId:user\.id/);assert.match(s,/recordedAt/);assert.match(s,/UPDATE assessments SET result_json/);});
