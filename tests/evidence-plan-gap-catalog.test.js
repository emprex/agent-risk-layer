import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencePlanCatalog } from '../public/evidence-plan.js';
test('outbound boundary remains a bounded evidence question',()=>{const c=evidencePlanCatalog().find(x=>x.id==='egress-boundary');assert.equal(c.caseId,'RT-TOOL-004');assert.match(c.title,/outbound network boundary/i);});
