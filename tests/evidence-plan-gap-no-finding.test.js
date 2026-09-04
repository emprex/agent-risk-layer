import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('record evidence gap does not create finding semantics',()=>{const s=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');assert.match(s,/This is not a PASS, finding or verified control/);});
