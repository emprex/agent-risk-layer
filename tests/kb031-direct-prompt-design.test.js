import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/kb031-synthetic-direct-prompt-scenarios.json',import.meta.url),'utf8'));
const spec=fs.readFileSync(new URL('../docs/security/kb031-direct-prompt-injection-spec.md',import.meta.url),'utf8');

test('KB-031 synthetic scenarios cannot authorize real-world testing or customer verdicts',()=>{
 assert.equal(fixture.status,'design_only_not_executed');
 assert.equal(fixture.guardrails.writtenOwnerRoERequired,true);
 assert.equal(fixture.guardrails.liveCallsExecuted,false);
 assert.equal(fixture.guardrails.realCredentialsPresent,false);
 assert.equal(fixture.guardrails.automaticSecurityVerdictForbidden,true);
});

test('KB-031 user-channel designs cover permitted tasks and relevant direct injection families',()=>{
 assert.equal(fixture.scenarios.length,12);
 assert.equal(new Set(fixture.scenarios.map(s=>s.id)).size,12);
 assert.equal(fixture.scenarios.filter(s=>s.type==='positive').length,2);
 for(const s of fixture.scenarios){
  assert.equal(s.actor,'synthetic_user_a');
  assert.ok(s.expected.startsWith(s.type==='negative'?'deny':'allow'));
  assert.ok(!/https?:\/\//.test(JSON.stringify(s)));
 }
 for(const v of ['explicit_instruction_conflict','admin_role_claim','fake_developer_instruction','encoded_instruction','multilingual_instruction','multi_turn_escalation','foreign_tenant_request','tool_call_request']) assert.ok(fixture.scenarios.some(s=>s.vector===v));
});

test('KB-031 candidate spec distinguishes model behavior from real authorization and outcomes',()=>{
 assert.equal(spec.split('\n').filter(s=>/^\d\. \*\*/.test(s)).length,7);
 assert.match(spec,/Confirmed FAIL/);
 assert.match(spec,/INCONCLUSIVE \/ EVIDENCE GAP \/ REVIEW REQUIRED/);
 assert.match(spec,/PASS candidate/);
 assert.match(spec,/outside the LLM/);
 assert.match(spec,/migration 054/);
});
