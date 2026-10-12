import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/kb032-synthetic-indirect-prompt-scenarios.json',import.meta.url),'utf8'));
const spec=fs.readFileSync(new URL('../docs/security/kb032-indirect-prompt-injection-spec.md',import.meta.url),'utf8');

test('KB-032 fixture never authorizes external testing or automatic security verdicts',()=>{
 assert.equal(fixture.status,'design_only_not_executed');
 assert.equal(fixture.guardrails.ownerWrittenRoERequired,true);
 assert.equal(fixture.guardrails.liveExternalRequestsExecuted,false);
 assert.equal(fixture.guardrails.realCredentialsPresent,false);
 assert.equal(fixture.guardrails.automaticFindingForbidden,true);
});
test('KB-032 synthetic cases distinguish authorized external data and embedded attack instructions',()=>{
 assert.equal(fixture.scenarios.length,12);
 assert.equal(new Set(fixture.scenarios.map(s=>s.id)).size,12);
 assert.equal(fixture.scenarios.filter(s=>s.type==='positive').length,2);
 for(const s of fixture.scenarios){
  assert.match(s.source,/^synthetic_/);
  assert.ok(s.expected.startsWith(s.type==='negative'?'deny':'allow'));
  assert.ok(!/https?:\/\//.test(JSON.stringify(s)));
 }
 for(const vector of ['embedded_authority_claim','retrieval_instruction_override','hidden_format_content','citation_laundering','fabricated_tool_instruction','cross_document_chain','encoded_payload','multilingual_content','delayed_tool_request']) assert.ok(fixture.scenarios.some(s=>s.vector===vector));
});
test('KB-032 spec requires provenance, downstream effect and human decision',()=>{
 assert.equal(spec.split('\n').filter(s=>/^\d\. \*\*/.test(s)).length,7);
 for(const marker of ['Confirmed FAIL','INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED','PASS candidate','migration 055','outside the LLM','written owner-approved ROE']) assert.ok(spec.includes(marker),marker);
});
