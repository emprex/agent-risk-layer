import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRiskKnowledge,digestRecord} from '../scripts/risk-knowledge-quality.mjs';

const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../docs/KB_RETEST_REVIEW_MANIFEST_2026-10-15.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/059_canonical_retest_acceptance_82.sql',import.meta.url),'utf8');
const publicAsset=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));

test('82 controls have exact-case positive and abuse retest procedures, no generic universal denial',()=>{
 assert.equal(manifest.revised_controls.length,82);
 assert.equal(new Set(manifest.revised_controls.map(x=>x.id)).size,82);
 assert.equal(asset.entries.length,108);
 assert.equal(asset.entries.reduce((n,e)=>n+e.check.required_evidence.length,0),575);
 for(const record of manifest.revised_controls){
  const e=asset.entries.find(x=>x.id===record.id);
  assert.ok(e,record.id);
  const a=e.solution.retest_acceptance;
  assert.equal(a.length,4,record.id);
  assert.equal(e.check.positive_test,record.positive_test,record.id);
  assert.equal(e.check.negative_test,record.negative_test,record.id);
  assert.match(a[0],/Original failure verification/);
  assert.match(a[0],/exact remediated version/);
  assert.ok(a[1].includes(record.positive_test),record.id+' positive test');
  assert.ok(a[2].includes(record.negative_test),record.id+' negative test');
  assert.match(a[3],/original failure, exact retest evidence digests/);
  assert.match(a[3],/missing lineage or unresolved regression keeps closure blocked/);
  assert.doesNotMatch(a.join(' '),/Unauthorised identity, boundary-crossing, malformed-input, replay and relevant bypass variants are denied before execution/);
  assert.match(e.review.review_status,/independent practitioner and customer validation required/i);
  assert.equal(digestRecord(e),e.content_digest,record.id);
 }
 assert.equal(auditRiskKnowledge(asset).findings.length,0);
});
test('quality gate catches regression to generic retest even if entry digest is valid',()=>{
 const broken=structuredClone(asset),e=broken.entries.find(x=>x.id==='ARL-KB-101');
 e.solution.retest_acceptance[2]='ARL-KB-101: Unauthorised identity, boundary-crossing, malformed-input, replay and relevant bypass variants are denied before execution.';
 e.content_digest=digestRecord(e);
 const issues=auditRiskKnowledge(broken).findings;
 assert.ok(issues.some(x=>x.id===e.id&&x.issue==='generic_or_mismatched_retest'&&x.field==='solution.retest_acceptance[2]'));
});
test('migration 059 updates only entry-review and solution retest criteria, preserves stored evidence and decisions',()=>{
 assert.equal((migration.match(/^UPDATE risk_knowledge_entries SET /gm)||[]).length,82);
 assert.equal((migration.match(/^UPDATE risk_knowledge_solutions SET /gm)||[]).length,82);
 assert.doesNotMatch(migration,/^UPDATE risk_knowledge_checks SET /m);
 assert.doesNotMatch(migration,/\b(?:DELETE FROM|DROP TABLE|TRUNCATE TABLE|UPDATE (?:control_test_executions|control_evidence_items|control_deployment_decisions|deployment_decision_evidence))\b/i);
 for(const {id} of manifest.revised_controls){
  const e=asset.entries.find(x=>x.id===id);
  assert.ok(migration.includes("WHERE id='"+id+"';"),id);
  assert.ok(migration.includes("WHERE entry_id='"+id+"';"),id);
  assert.ok(migration.includes("content_digest='"+e.content_digest+"'"),id);
  assert.ok(migration.includes("retest_acceptance_json='"+JSON.stringify(e.solution.retest_acceptance).replaceAll("'","''")+"'"),id);
  assert.equal(publicAsset.entries.find(x=>x.id===id)?.content_digest,e.content_digest,id);
 }
});
