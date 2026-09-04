import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence gap requires an evidence-based rationale',()=>{const s=fs.readFileSync(new URL('../src/evidence-plan-resolution-preload.js',import.meta.url),'utf8');assert.match(s,/rationale\.length<20/);assert.match(s,/specific evidence-based rationale/);});
