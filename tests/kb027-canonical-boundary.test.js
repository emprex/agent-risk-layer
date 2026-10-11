import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const entry=asset.entries.find(e=>e.id==='ARL-KB-027');
const pub=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/050_risk_knowledge_kb027_api_key_scope.sql',import.meta.url),'utf8');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');

test('KB-027 signed record and additive migration 050 agree',()=>{
 assert.equal(asset.entries.length,108);
 assert.ok(entry);
 const {content_digest,...unsigned}=entry;
 assert.equal(digest(unsigned),content_digest);
 assert.equal(content_digest,'56f0bf217306b3792d19af4c30d2d71d6d74645583cf7fbfe0d4a91a9585ffb2');
 for(const value of [content_digest,digest(entry.check),digest(entry.solution),digest(entry.operational_metadata)])
   assert.ok(migration.includes(value));
 assert.equal(entry.validation.status,'candidate');
 assert.equal(entry.review.human_review_required,true);
 assert.equal(entry.operational_metadata.customer_validation_status,'unvalidated');
 assert.equal(pub.entries.find(e=>e.id===entry.id).content_digest,content_digest);
 assert.deepEqual(pub.entries.find(e=>e.id===entry.id).problem,entry.problem);
});

test('KB-027 requires seven evidence classes and distinct FAIL vs evidence gap',()=>{
 assert.equal(entry.check.required_evidence.length,7);
 assert.match(entry.check.fail_condition,/confirmed FAIL/);
 assert.match(entry.check.fail_condition,/INCONCLUSIVE \\/ EVIDENCE GAP \\/ REVIEW REQUIRED/);
 assert.match(entry.check.fail_condition,/block PASS and deployment/);
 assert.match(entry.check.pass_condition,/accountable human review/);
 assert.match(entry.check.method,/written owner-authorised ROE/);
 assert.match(entry.check.required_evidence[4],/revoked/);
 assert.match(entry.check.required_evidence[5],/runtime/);
 assert.doesNotMatch(entry.check.fail_condition,/fails when.*unsupported by reproducible evidence/i);
});

test('KB-027 migration appended after prior KB-025 and KB-026 with no historical writes',()=>{
 const src=fs.readFileSync(new URL('../src/db-adapters/sqlite-local.js',import.meta.url),'utf8');
 const last=['048_risk_knowledge_kb025_tenant_isolation.sql','049_risk_knowledge_kb026_service_identity.sql','050_risk_knowledge_kb027_api_key_scope.sql'].map(s=>src.indexOf("'"+s+"'"));
 assert.ok(last.every((x,i)=>x>=0 && (i===0||x>last[i-1])));
 assert.match(migration,/WHERE id='ARL-KB-027'/);
 assert.match(migration,/WHERE entry_id='ARL-KB-027'/);
 assert.doesNotMatch(migration,/\bDROP\b|\bDELETE\s+FROM\b/i);
});
