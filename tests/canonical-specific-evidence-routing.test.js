import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyCanonicalEvidenceRequirement} from '../src/agent/canonical-evidence-requirement-plan.mjs';

const kb=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const revision=JSON.parse(fs.readFileSync(new URL('../docs/KB_EVIDENCE_REVIEW_MANIFEST_2026-10-15.json',import.meta.url),'utf8'));
const byId=new Map(kb.entries.map(e=>[e.id,e]));

test('reviewed canonical requirement text retains useful deterministic collector routing',()=>{
 const expected=revision.required_evidence_replacements;
 assert.equal(Object.keys(expected).length,81);
 let machine=0,reviewOnly=0;
 for(const [suffix,description] of Object.entries(expected)){
  const id='ARL-KB-'+suffix;
  const req=byId.get(id)?.check?.required_evidence?.[1];
  assert.equal(req,id+' '+description,id);
  const route=classifyCanonicalEvidenceRequirement(req);
  assert.ok(['machine_collectable','human_only','active_test_or_runtime'].includes(route.mode),id);
  if(route.mode==='machine_collectable'){
   machine++;
   assert.equal(route.collectors.length,1,id+' should have one relevant primary static family');
  }else{
   reviewOnly++;
   assert.deepEqual(route.collectors,[],id);
  }
 }
 assert.ok(machine>=75,'a wording change must not quietly remove static candidate visibility');
 assert.ok(reviewOnly<=6,'human/runtime requirements remain separately gated');
});
test('explicit routes are reviewed per evidence domain, not inferred from the risk title',()=>{
 const probes={
  'ARL-KB-015':'architecture_and_inventory',
  'ARL-KB-016':'dependency_and_build',
  'ARL-KB-034':'source_and_configuration',
  'ARL-KB-057':'network_and_egress',
  'ARL-KB-101':'policy_and_documentation'
 };
 for(const [id,collector] of Object.entries(probes)){
  const classification=classifyCanonicalEvidenceRequirement(byId.get(id).check.required_evidence[1]);
  assert.equal(classification.mode,'machine_collectable',id);
  assert.deepEqual(classification.collectors,[collector],id);
 }
 const original=byId.get('ARL-KB-060').check.required_evidence[1];
 const mutated=classifyCanonicalEvidenceRequirement(original+' arbitrary external change');
 assert.equal(mutated.mode,'human_only');
 assert.deepEqual(mutated.collectors,[]);
});
test('runtime and accountable human evidence retain precedence over static hints',()=>{
 const active=classifyCanonicalEvidenceRequirement(byId.get('ARL-KB-106').check.required_evidence[1]);
 assert.equal(active.mode,'active_test_or_runtime');
 assert.deepEqual(active.collectors,[]);
 const human=classifyCanonicalEvidenceRequirement('ARL-KB-059 accountable human reviewer and approval record');
 assert.equal(human.mode,'human_only');
 assert.deepEqual(human.collectors,[]);
});
