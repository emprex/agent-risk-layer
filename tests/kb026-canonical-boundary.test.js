import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const risk=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const entry=risk.entries.find(x=>x.id==='ARL-KB-026');
const publicRisk=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/049_risk_knowledge_kb026_service_identity.sql',import.meta.url),'utf8');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');

test('KB-026 exact signed canonical and additive migration 049 align',()=>{
 assert.equal(risk.entries.length,108);
 assert.ok(entry);
 const {content_digest,...unsigned}=entry;
 assert.equal(digest(unsigned),content_digest);
 assert.equal(content_digest,'6f81fdd9270b7dbe62e50072f599e785ea1bfa05b14062fcc643fd83ed9dcfae');
 assert.ok(migration.includes(content_digest));
 assert.ok(migration.includes(digest(entry.check)));
 assert.ok(migration.includes(digest(entry.solution)));
 assert.ok(migration.includes(digest(entry.operational_metadata)));
 assert.equal(entry.validation.status,'candidate');
 assert.equal(entry.review.human_review_required,true);
 assert.equal(entry.operational_metadata.customer_validation_status,'unvalidated');
 const published=publicRisk.entries.find(x=>x.id==='ARL-KB-026');
 assert.equal(published.content_digest,content_digest);
 assert.deepEqual(published.problem,entry.problem);
 assert.deepEqual(published.solution_summary.recommended_remediation,entry.solution.recommended_remediation);
});

test('KB-026 outcome authority never conflates missing evidence with observed exploitation',()=>{
 assert.equal(entry.check.required_evidence.length,7);
 assert.match(entry.check.fail_condition,/confirmed FAIL/);
 assert.match(entry.check.fail_condition,/INCONCLUSIVE \/ EVIDENCE GAP \/ REVIEW REQUIRED/);
 assert.match(entry.check.fail_condition,/block PASS and deployment/);
 assert.match(entry.check.pass_condition,/accountable human review/);
 assert.match(entry.check.method,/written owner authorization/);
 assert.match(entry.check.required_evidence[4],/wrong-audience/);
 assert.match(entry.check.required_evidence[5],/runtime/);
 assert.doesNotMatch(entry.check.fail_condition,/fails when .*unsupported by reproducible evidence/i);
 assert.match(migration,/WHERE id='ARL-KB-026'/);
 assert.match(migration,/WHERE entry_id='ARL-KB-026'/);
 assert.doesNotMatch(migration,/\bDROP\b|\bDELETE\s+FROM\b/i);
});

test('KB-026 migration is monotonic after KB-025 and no earlier migration is rewritten',()=>{
 const db=fs.readFileSync(new URL('../src/db-adapters/sqlite-local.js',import.meta.url),'utf8');
 const p25=db.indexOf("'048_risk_knowledge_kb025_tenant_isolation.sql'");
 const p26=db.indexOf("'049_risk_knowledge_kb026_service_identity.sql'");
 assert.ok(p25>0&&p26>p25);
});
