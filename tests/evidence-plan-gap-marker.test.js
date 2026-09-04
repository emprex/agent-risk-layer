import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('evidence gap is a review disposition, never a pass or finding',()=>{
 const ui=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');
 const api=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');
 assert.match(ui,/Record evidence gap/);
 assert.match(ui,/evidence-gap/);
 assert.match(ui,/not a PASS, verified control, confirmed finding or deployment approval/i);
 assert.match(api,/VALID_STATES = new Set\(\['not-applicable','evidence-gap'\]\)/);
 assert.match(api,/evidence_plan_gap_recorded/);
});
