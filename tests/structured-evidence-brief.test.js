import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStructuredAdvisory,renderStructuredAdvisory} from '../src/agent/ai/structured-evidence-brief.mjs';
const digest='a'.repeat(64);
const facts=[{id:'O2_1',artifactSha256:digest,text:'Bounded metadata: providerPackageCandidates=["mcp"]'},{id:'R2',text:'Provider inventory required'},{id:'F2',text:'Control objective'}];
const json=items=>JSON.stringify({schema:'arl.ai.evidence-brief.v1',items});
test('structured reviewer briefing preserves observed SHA and requirement lineage',()=>{
 const result=validateStructuredAdvisory(json([{type:'observation',text:'Metadata contains an MCP package candidate.',factIds:['O2_1'],artifactSha256:[digest]},{type:'verification',text:'Compare provider inventory against approved scope.',factIds:['R2'],artifactSha256:[]}]),facts);
 assert.equal(result.ok,true);
 assert.deepEqual(result.items[0].artifactSha256,[digest]);
 assert.match(renderStructuredAdvisory(result.items),/OBSERVATION:/);
});
test('forbids invented source digest, ungrounded observations and fake requirement verification',()=>{
 assert.equal(validateStructuredAdvisory(json([{type:'observation',text:'Observed provider.',factIds:['F2'],artifactSha256:[]}]),facts).reason,'observation_requires_source_fact');
 assert.equal(validateStructuredAdvisory(json([{type:'observation',text:'Observed metadata.',factIds:['O2_1'],artifactSha256:['b'.repeat(64)]}]),facts).reason,'unbound_artifact_digest');
 assert.equal(validateStructuredAdvisory(json([{type:'verification',text:'Check source.',factIds:['F2'],artifactSha256:[]}]),facts).reason,'verification_requires_requirement');
});
test('refuses unsupported fail/pass decisions and unrestricted prose output',()=>{
 assert.equal(validateStructuredAdvisory(json([{type:'observation',text:'The assessment objective is not met.',factIds:['O2_1'],artifactSha256:[digest]}]),facts).reason,'unsupported_security_conclusion');
 assert.equal(validateStructuredAdvisory('Everything is safe [F2].',facts).reason,'invalid_json');
});
