import test from 'node:test';
import assert from 'node:assert/strict';
import {collectControlEvidence} from '../src/agent/control-evidence-selection.mjs';

test('shared collector binds every fact to its requirement digest, independent of target ID',()=>{
 const hash='a'.repeat(64);
 const controls=[{controlId:'ARL-KB-099',reviewRequirements:[
  {artifactDigests:[hash],boundedSourceFacts:[
   {artifactSha256:hash,values:{dependencyCount:2,discoveryCoverage:{trackedFileScanCapped:true}}},
   {artifactSha256:'b'.repeat(64),values:{dependencyCount:999}}]},
  {artifactDigests:[],boundedSourceFacts:[{artifactSha256:hash,values:{dependencyCount:777}}]}
 ]}];
 const b=collectControlEvidence({controls},'ARL-KB-099');
 assert.equal(b.facts.length,1);
 assert.equal(b.facts[0].values.dependencyCount,2);
 assert.equal(b.candidateRequirements,1);
 assert.equal(b.totalRequirements,2);
 assert.equal(b.limitedCoverage,true);
 assert.equal(collectControlEvidence({controls},'ARL-KB-100'),null);
});
test('unverified source facts cannot gain lineage through another requirement',()=>{
 const hash='c'.repeat(64);
 const r=collectControlEvidence({controls:[{controlId:'ARL-KB-023',reviewRequirements:[
  {artifactDigests:[],boundedSourceFacts:[{artifactSha256:hash,values:{dependencyCount:100}}]},
  {artifactDigests:[hash],boundedSourceFacts:[]}
 ]}]},'ARL-KB-023');
 assert.deepEqual(r.facts,[]);
 assert.equal(r.candidateRequirements,1);
});

test('collection limits and completeness signals do not cross requirement boundaries',()=>{
 const capped='a'.repeat(64),complete='b'.repeat(64);
 const evidence=collectControlEvidence({controls:[{controlId:'ARL-KB-099',reviewRequirements:[
  {artifactDigests:[capped],boundedSourceFacts:[
   {artifactSha256:capped,values:{discoveryCoverage:{trackedFileScanCapped:true}}}]},
  {artifactDigests:[complete],boundedSourceFacts:[
   {artifactSha256:complete,values:{discoveryCoverage:{completeTrackedAndTextScan:true}}}]},
  {artifactDigests:[],boundedSourceFacts:[
   {artifactSha256:capped,values:{discoveryCoverage:{textFileScanCapped:true}}}]},
  {artifactDigests:[complete],boundedSourceFacts:[
   {artifactSha256:'c'.repeat(64),values:{discoveryCoverage:{textFileScanCapped:true}}}]}
 ]}]},'ARL-KB-099');
 assert.equal(evidence.limitedCoverage,true);
 assert.equal(evidence.requirements[0].boundedScanCoverageState,'limited_bounded_scan');
 assert.equal(evidence.requirements[1].boundedScanCoverageState,'reported_complete_bounded_scan');
 assert.equal(evidence.requirements[1].limitedCoverage,false);
 assert.equal(evidence.requirements[2].boundedScanCoverageState,'unknown');
 assert.equal(evidence.requirements[3].boundedScanCoverageState,'unknown');
 assert.equal(evidence.requirements[3].limitedCoverage,false);
});
