import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('bounded check exposes all three reviewer actions',()=>{const s=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');assert.match(s,/Open bounded check/);assert.match(s,/Record evidence gap/);assert.match(s,/Mark not applicable/);});
