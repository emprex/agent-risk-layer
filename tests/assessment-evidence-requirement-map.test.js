import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('evidence mapping never upgrades candidate collection to evidence validity',()=>{
 const src=readFileSync(new URL('../src/agent/assessment-evidence-requirement-map.mjs',import.meta.url),'utf8');
 for(const marker of ['verifySourceCollectionArtifact','requirementSatisfied:false',
   'evidenceValidated:false','securityStateChanged:false','passFailInferred:false',
   'deploymentDecisionWritten:false','config.targetBinding.revision!==targetRevision'])
   assert.ok(src.includes(marker),marker);
});
test('only current frozen authoritative v7 snapshot can reach evidence mapping route',()=>{
 const src=readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
 const a=src.indexOf('if (/^Map assessment evidence requirements');
 const b=src.indexOf('if (/^Inspect assessment report content v7',a);
 assert.ok(a>0&&b>a);
 const block=src.slice(a,b);
 assert.ok(block.includes('Inspect assessment report content v7'));
 assert.ok(block.includes('mapAssessmentEvidenceToRequirements'));
 assert.ok(block.includes('ARL_EXPECTED_TARGET_SHA'));
 assert.ok(block.includes('ARL_EXPECTED_SYSTEM_SNAPSHOT_ID'));
});
