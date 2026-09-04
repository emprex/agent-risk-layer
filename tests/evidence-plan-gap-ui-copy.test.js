import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence plan explains evidence still needed',()=>{const s=fs.readFileSync(new URL('../public/inspector-evidence-plan.js',import.meta.url),'utf8');assert.match(s,/Evidence still needed/);assert.match(s,/Runtime verification disposition/);});
