import test from 'node:test';
import assert from 'node:assert/strict';
import {screenAdvisoryClaims} from '../src/agent/ai/advisory-claim-guard.mjs';
const facts=[{id:'O2_1',text:'Static inventory metadata'}, {id:'R1',text:'Expected provider approvals'}, {id:'F2',text:'Assessment objective'}];
test('rejects original KB-007 unsupported compliance conclusion despite citations',()=>{
 const response='Metadata suggests package references [O2_1]. The assessment objective [F2] is not met due to missing validation.';
 assert.equal(screenAdvisoryClaims(response,facts).reason,'unsupported_security_conclusion');
});
test('rejects unsupported missing approval and test execution claims',()=>{
 assert.equal(screenAdvisoryClaims('No approval evidence was found [R1].',facts).reason,'unsupported_security_conclusion');
 assert.equal(screenAdvisoryClaims('No real third-party service was exercised [F2].',facts).reason,'unsupported_security_conclusion');
});
test('requires every paragraph to use known facts',()=>{
 assert.equal(screenAdvisoryClaims('Observed metadata [O2_1].\n\nThis means everything is safe.',facts).reason,'missing_or_unknown_citation');
 assert.equal(screenAdvisoryClaims('Metadata was collected [FAKE].',facts).reason,'missing_or_unknown_citation');
});
test('allows careful candidate observation and scoped next verification',()=>{
 const response='Package candidates were observed in static metadata, but runtime use was not established [O2_1].\n\nRequest the approved provider list and compare it to collected metadata; human confirmation is needed [R1].';
 assert.deepEqual(screenAdvisoryClaims(response,facts),{ok:true});
});
