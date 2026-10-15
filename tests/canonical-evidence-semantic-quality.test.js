import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRiskKnowledge,digestRecord} from '../scripts/risk-knowledge-quality.mjs';

const canonical=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const revision=JSON.parse(fs.readFileSync(new URL('../docs/KB_EVIDENCE_REVIEW_MANIFEST_2026-10-15.json',import.meta.url),'utf8'));
const migration=fs.readFileSync(new URL('../migrations/057_canonical_evidence_review_81.sql',import.meta.url),'utf8');
const publicAsset=JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json',import.meta.url),'utf8'));

test('all 81 canonical evidence requests are individually reviewed candidates, not boilerplate',()=>{
 assert.equal(canonical.entries.length,108);
 assert.equal(canonical.entries.reduce((n,e)=>n+e.check.required_evidence.length,0),575);
 const proposed=revision.required_evidence_replacements;
 assert.equal(Object.keys(proposed).length,81);
 const variants=new Set();
 for(const [suffix,requirement] of Object.entries(proposed)){
  assert.match(suffix,/^\d{3}$/);
  const id='ARL-KB-'+suffix;
  const entry=canonical.entries.find(e=>e.id===id);
  assert.ok(entry,id);
  assert.equal(entry.check.required_evidence[1],id+' '+requirement,id);
  assert.ok(requirement.length>=100,id+' should have a specific evidence request');
  assert.ok(!/showing how reduce|for this control\.?$/i.test(requirement),id);
  assert.match(entry.review.review_status,/independent practitioner and customer validation required/i,id);
  assert.equal(digestRecord(entry),entry.content_digest,id);
  variants.add(requirement);
 }
 assert.equal(variants.size,81,'no duplicate evidence request descriptions');
 assert.equal(auditRiskKnowledge(canonical).findings.length,0);
});

test('semantic quality rejects a return to boilerplate even with a matching digest',()=>{
 const damaged=structuredClone(canonical);
 const one=damaged.entries.find(e=>e.id==='ARL-KB-016');
 one.check.required_evidence[1]='ARL-KB-016 control configuration or source location showing how reduce the likelihood and impact of model versions.';
 one.content_digest=digestRecord(one);
 const report=auditRiskKnowledge(damaged);
 assert.ok(report.findings.some(x=>x.id===one.id&&
  x.issue==='generic_or_malformed_required_evidence'),JSON.stringify(report.findings.slice(0,3)));
});

test('generated public claims and immutable migration preserve 81 source-bound revisions',()=>{
 const byId=new Map(publicAsset.entries.map(e=>[e.id,e]));
 const revised=Object.keys(revision.required_evidence_replacements);
 assert.equal(revised.length,81);
 assert.equal((migration.match(/^UPDATE risk_knowledge_entries SET /gm)||[]).length,81);
 assert.equal((migration.match(/^UPDATE risk_knowledge_checks SET /gm)||[]).length,81);
 for(const suffix of revised){
  const id='ARL-KB-'+suffix;
  const entry=canonical.entries.find(e=>e.id===id);
  assert.equal(byId.get(id).content_digest,entry.content_digest,id);
  const escaped=JSON.stringify(entry.check.required_evidence).replaceAll("'","''");
  assert.ok(migration.includes("required_evidence_json='"+escaped+"'"),id+' SQL evidence');
  assert.ok(migration.includes("WHERE entry_id='"+id+"';"),id);
  assert.ok(migration.includes("WHERE id='"+id+"';"),id);
  assert.ok(migration.includes("content_digest='"+entry.content_digest+"'"),id);
 }
 for(const fragment of ['DELETE FROM','TRUNCATE','UPDATE findings','UPDATE control_tests','UPDATE control_evidence'])
  assert.ok(!migration.includes(fragment),fragment);
});
