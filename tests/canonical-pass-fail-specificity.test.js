import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRiskKnowledge,digestRecord} from '../scripts/risk-knowledge-quality.mjs';

const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../docs/KB_PASS_FAIL_SPECIFICITY_2026-10-15.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/058_canonical_pass_fail_specificity_78.sql',import.meta.url),'utf8');
const publicAsset=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));

test('all 78 affected controls have scope-specific success and concrete failure conditions',()=>{
 const map=manifest.pass_conditions;
 assert.equal(Object.keys(map).length,78);
 assert.equal(asset.entries.length,108);
 assert.equal(asset.entries.reduce((n,e)=>n+e.check.required_evidence.length,0),575);
 let checked=0;
 for(const [suffix,condition] of Object.entries(map)){
  const id='ARL-KB-'+suffix;
  const e=asset.entries.find(x=>x.id===id);
  assert.ok(e,id);
  assert.equal(e.check.pass_condition,id+' is eligible for a PASS only when '+condition+
   '. Observations must be bound to the exact assessed version, executed within written test authority where applicable, and independently accepted by an accountable human; missing evidence remains INCONCLUSIVE.',id);
  assert.match(e.check.fail_condition,new RegExp('^'+id+' fails when '),id);
  assert.match(e.check.fail_condition,/A FAIL requires evidence of that actual condition in the approved scope and an accountable human finding/);
  assert.match(e.check.fail_condition,/INCONCLUSIVE rather than proving absence or breach/);
  assert.doesNotMatch(e.check.pass_condition,/denial occurs before side effects|valid workflow remains bounded to/i);
  assert.doesNotMatch(e.check.fail_condition,/relevant control is declaration-only/i);
  assert.match(e.review.review_status,/independent practitioner and customer validation required/i);
  assert.equal(digestRecord(e),e.content_digest,id);
  checked++;
 }
 assert.equal(checked,78);
 assert.equal(auditRiskKnowledge(asset).findings.length,0);
});
test('quality gate rejects reverted generic PASS and FAIL even if digest is recomputed',()=>{
 const testAsset=structuredClone(asset);
 const e=testAsset.entries.find(x=>x.id==='ARL-KB-101');
 e.check.pass_condition='ARL-KB-101 passes only when “Generic test” is not reproducible, the valid workflow remains bounded to agent and model context, denial occurs before side effects, and version-bound observed evidence matches expected decision.';
 e.check.fail_condition='ARL-KB-101 fails when the reviewer is absent, or when the relevant control is declaration-only, bypassable, fail-open.';
 e.content_digest=digestRecord(e);
 const findings=auditRiskKnowledge(testAsset).findings;
 assert.ok(findings.some(x=>x.id===e.id&&x.field==='check.pass_condition'&&x.issue==='generic_or_mismatched_pass_fail'));
 assert.ok(findings.some(x=>x.id===e.id&&x.field==='check.fail_condition'&&x.issue==='generic_or_mismatched_pass_fail'));
});
test('migration 058 updates only canonical criteria and digests without changing historical findings',()=>{
 assert.equal((migration.match(/^UPDATE risk_knowledge_entries SET /gm)||[]).length,78);
 assert.equal((migration.match(/^UPDATE risk_knowledge_checks SET /gm)||[]).length,78);
 for(const suffix of Object.keys(manifest.pass_conditions)){
  const id='ARL-KB-'+suffix,e=asset.entries.find(x=>x.id===id);
  assert.ok(migration.includes("WHERE entry_id='"+id+"';"),id);
  assert.ok(migration.includes("WHERE id='"+id+"';"),id);
  assert.ok(migration.includes("content_digest='"+e.content_digest+"'"),id);
  assert.ok(migration.includes("pass_condition='"+e.check.pass_condition.replaceAll("'","''")+"'"),id);
  assert.ok(migration.includes("fail_condition='"+e.check.fail_condition.replaceAll("'","''")+"'"),id);
  assert.equal(publicAsset.entries.find(x=>x.id===id)?.content_digest,e.content_digest,id);
 }
 assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|DELETE FROM|UPDATE (?:findings|control_test_executions|control_evidence_items|control_deployment_decisions))\b/i);
});
