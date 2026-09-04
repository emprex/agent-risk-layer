import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePlan } from '../public/evidence-plan.js';

test('recorded outbound evidence gap lets reviewer advance without claiming verification',()=>{
 const assessment={result:{blockingEvidenceGaps:[{id:'outbound network egress',status:'evidence-required'}],evidencePlanResolutions:{'egress-boundary':{state:'evidence-gap',rationale:'Runtime verification was not completed against the frozen target.'}}}};
 const plan=buildEvidencePlan({assessment,inspections:[{id:'ins'}]});
 assert.equal(plan.checks.length,0);
 assert.equal(plan.resolved[0].resolution.state,'evidence-gap');
 assert.match(plan.explanation,/not a deployment approval/i);
});
