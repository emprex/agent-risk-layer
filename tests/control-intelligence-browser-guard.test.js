import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{browserValidatorViolations}from'../scripts/check-browser-validator.mjs';
const validator=fs.readFileSync(path.resolve(import.meta.dirname,'../scripts/verify-control-intelligence-browser.mjs'),'utf8');
test('Control Intelligence browser validator uses visible controls without application API bypass',()=>assert.deepEqual(browserValidatorViolations(validator),[]));
test('browser validator guard rejects hidden workflow mutation',()=>{const unsafe="const result=await evaluate(`fetch('/api/projects/p/control-intelligence',{method:'POST'})`)";assert.ok(browserValidatorViolations(unsafe).length>0)});
