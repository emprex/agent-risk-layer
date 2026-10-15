import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const entry=asset.entries.find(x=>x.id==='ARL-KB-028');
const pub=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/051_risk_knowledge_kb028_revoked_authority.sql',import.meta.url),'utf8');
const unchanged=JSON.parse(fs.readFileSync(new URL('./fixtures/kb028-unchanged-control-digests.json',import.meta.url),'utf8'));
const revised=new Set(Object.keys(JSON.parse(fs.readFileSync(new URL('../docs/KB_EVIDENCE_REVIEW_MANIFEST_2026-10-15.json',import.meta.url),'utf8')).required_evidence_replacements).map(s=>'ARL-KB-'+s));
const revisionMigration=fs.readFileSync(new URL('../migrations/057_canonical_evidence_review_81.sql',import.meta.url),'utf8');
const latestCriteria=new Set(Object.keys(JSON.parse(fs.readFileSync(new URL('../docs/KB_PASS_FAIL_SPECIFICITY_2026-10-15.json',import.meta.url),'utf8')).pass_conditions).map(s=>'ARL-KB-'+s));
const latestMigration=fs.readFileSync(new URL('../migrations/058_canonical_pass_fail_specificity_78.sql',import.meta.url),'utf8');
const retestRevision=new Set(JSON.parse(fs.readFileSync(new URL('../docs/KB_RETEST_REVIEW_MANIFEST_2026-10-15.json',import.meta.url),'utf8')).revised_controls.map(x=>x.id));
const retestMigration=fs.readFileSync(new URL('../migrations/059_canonical_retest_acceptance_82.sql',import.meta.url),'utf8');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
test('KB-028 independently verifies all 108 signatures and additive migration 051',()=>{
 assert.equal(asset.entries.length,108);
 for(const item of asset.entries){
  const {content_digest,...unsigned}=item;
  assert.equal(digest(unsigned),content_digest);
  // Stacked semantic migrations may change their own control only; KB-029 is independently verified by its own exact-head boundary test.
  const laterKB029 = item.id==='ARL-KB-029' && fs.existsSync(new URL('../migrations/052_risk_knowledge_kb029_principal_accountability.sql',import.meta.url));
  if(item.id!=='ARL-KB-028' && !laterKB029 && !revised.has(item.id))assert.equal(content_digest,unchanged[item.id]);
  if(revised.has(item.id))assert.ok((retestRevision.has(item.id)?retestMigration:latestCriteria.has(item.id)?latestMigration:revisionMigration).includes("content_digest='"+content_digest+"'"),item.id);
 }
 assert.equal(Object.keys(unchanged).length,107);
 assert.equal(entry.content_digest,'9a239967cf149448fc09b7e5e0591c786ee34eb5edb11ce7c391ec47928b7d6b');
 assert.equal(digest(entry.check),'43037bde64334f134f0f3451aca1514365cc94fc0aaab659046a3ad74674e77e');
 assert.equal(digest(entry.solution),'d387f8e346d052ed935a7bd8288c967c1c9aa085497aafe89b7de71e24fc8305');
 assert.ok(migration.includes(entry.content_digest));
 assert.ok(migration.includes(digest(entry.check)));
 assert.ok(migration.includes(digest(entry.solution)));
 assert.equal(pub.entries.find(x=>x.id==='ARL-KB-028').content_digest,entry.content_digest);
 assert.equal(entry.review.human_review_required,true);
 assert.equal(entry.validation.status,'candidate');
 assert.equal(entry.operational_metadata.customer_validation_status,'unvalidated');
});
test('KB-028 revocation evidence gap never becomes automatic FAIL or PASS',()=>{
 assert.equal(entry.check.required_evidence.length,7);
 assert.match(entry.check.fail_condition,/confirmed FAIL/);
 assert.match(entry.check.fail_condition,/INCONCLUSIVE \/ EVIDENCE GAP \/ REVIEW REQUIRED/);
 assert.match(entry.check.fail_condition,/block PASS and deployment/);
 assert.match(entry.check.pass_condition,/accountable human review/);
 assert.match(entry.check.method,/separate written owner authorization/);
 assert.doesNotMatch(migration,/\bDROP\b|\bDELETE\s+FROM\b/i);
 const db=fs.readFileSync(new URL('../src/db-adapters/sqlite-local.js',import.meta.url),'utf8');
 assert.ok(db.indexOf('050_risk_knowledge_kb027_api_key_scope.sql')<db.indexOf('051_risk_knowledge_kb028_revoked_authority.sql'));
});
