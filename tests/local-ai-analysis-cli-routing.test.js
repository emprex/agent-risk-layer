import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/agent/arl-local-assessment-runner.mjs',import.meta.url),'utf8');
test('local analysis CLI dispatch regex resolves three-digit controls rather than literal backslash-d',()=>{
 const match=source.match(/const analyseMatch=(\/.+?\/i)\.exec\(request\)/);
 assert.ok(match,'CLI branch must retain explicit parser');
 const regex=Function('return '+match[1])();
 assert.equal(regex.exec('Analyse collected evidence ARL-KB-007')?.[1],'ARL-KB-007');
 assert.equal(regex.exec('Analyse collected evidence ARL-KB-108')?.[1],'ARL-KB-108');
 assert.equal(regex.test('Analyse collected evidence ARL-KB-9999'),false);
});
