import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence gap UI never labels disposition verified',()=>{const s=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');assert.match(s,/Evidence still needed/);assert.doesNotMatch(s,/Evidence still needed<\/span>.*Verified/);});
