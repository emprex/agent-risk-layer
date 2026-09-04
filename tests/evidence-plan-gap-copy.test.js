import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('customer can distinguish evidence gap from not applicable',()=>{const s=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');assert.match(s,/Record an evidence gap when the boundary is material/);assert.match(s,/Use Not applicable only when reviewed evidence shows the boundary is not materially present/);});
