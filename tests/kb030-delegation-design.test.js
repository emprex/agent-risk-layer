import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/kb030-synthetic-delegation-scenarios.json',import.meta.url),'utf8'));
const spec=fs.readFileSync(new URL('../docs/security/kb030-impersonation-delegation-spec.md',import.meta.url),'utf8');

test('KB-030 test design cannot itself authorize impersonation or declare a finding',()=>{
 assert.equal(fixture.status,'design_only_not_executed');
 assert.equal(fixture.frozenTarget.sha,'b3116fcfcec3bf6967773c3e9587c502b1fed5e5');
 assert.equal(fixture.frozenTarget.inspection,'passive_read_only');
 assert.equal(fixture.guardrails.ownerWrittenRoERequired,true);
 assert.equal(fixture.guardrails.liveProviderCallsExecuted,false);
 assert.equal(fixture.guardrails.rawCredentialsPresent,false);
 assert.equal(fixture.guardrails.automaticFindingForbidden,true);
 assert.equal(fixture.guardrails.customerSecurityDecision,'HOLD');
});

test('KB-030 scenarios bind synthetic actor and subject to expected allow or deny',()=>{
 assert.equal(fixture.scenarios.length,11);
 assert.equal(new Set(fixture.scenarios.map(s=>s.id)).size,11);
 assert.ok(fixture.scenarios.some(s=>s.id==='self-approval'));
 assert.ok(fixture.scenarios.some(s=>s.id==='queued-job'));
 assert.ok(fixture.scenarios.some(s=>s.id==='wrong-tenant'));
 for(const s of fixture.scenarios){
  assert.match(s.actor,/^synthetic_/);
  assert.match(s.subject,/^synthetic_/);
  assert.ok(s.expected.startsWith(s.type==='negative'?'deny':'allow'));
  assert.ok(!JSON.stringify(s).includes('http://') && !JSON.stringify(s).includes('https://'));
 }
});

test('KB-030 documented evidence separates human policy, static inspection, runtime proof and review',()=>{
 const lines=spec.split('\n').filter(s=>/^\d\. \*\*/.test(s));
 assert.equal(lines.length,7);
 assert.match(spec,/Confirmed FAIL/);
 assert.match(spec,/INCONCLUSIVE \/ EVIDENCE GAP \/ REVIEW REQUIRED/);
 assert.match(spec,/PASS candidate/);
 assert.match(spec,/not\*\* evidence of a confirmed vulnerability/);
 assert.match(spec,/migration \*\*053\*\*/);
});
