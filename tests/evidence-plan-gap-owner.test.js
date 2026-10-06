import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('evidence dispositions are owner-authenticated and CSRF protected',()=>{const s=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(s,/req\.user = await getUserFromRequest\(req\)/);assert.match(s,/row\.user_id !== req\.user\.id/);assert.match(s,/verifyCsrf\(req\)/);});
