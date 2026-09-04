import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePlan } from '../public/evidence-plan.js';
test('evidence gap disposition removes only its selected bounded check',()=>{const gaps=[{id:'outbound network',status:'evidence-required'},{id:'approval human oversight',status:'evidence-required'}];const assessment={result:{blockingEvidenceGaps:gaps,evidencePlanResolutions:{'egress-boundary':{state:'evidence-gap',rationale:'Runtime verification could not be completed against the frozen target.'}}}};const p=buildEvidencePlan({assessment,inspections:[{}]});assert.equal(p.resolved.length,1);assert.equal(p.checks.length,1);assert.equal(p.checks[0].id,'approval-binding');});
