import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePlan } from '../public/evidence-plan.js';
test('not applicable and evidence gap stay distinct',()=>{for(const state of ['not-applicable','evidence-gap']){const p=buildEvidencePlan({assessment:{result:{blockingEvidenceGaps:[{id:'outbound network',status:'evidence-required'}],evidencePlanResolutions:{'egress-boundary':{state,rationale:'A sufficiently specific evidence rationale is recorded here.'}}}},inspections:[{}]});assert.equal(p.resolved[0].resolution.state,state);}});
