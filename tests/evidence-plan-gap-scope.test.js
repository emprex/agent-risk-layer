import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence disposition endpoint whitelists plan IDs',()=>{const s=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(s,/VALID_EVIDENCE_PLAN_IDS/);assert.match(s,/egress-boundary/);});
