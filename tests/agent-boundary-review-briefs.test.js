import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentBoundaryBriefs} from '../src/agent/agent-boundary-review-briefs.mjs';
test('missing primary evidence is never treated as a prompt injection finding',()=>{
 const controls=['ARL-KB-031','ARL-KB-053'].map(controlId=>({
  controlId,reviewRequirements:[{artifactDigests:[],boundedSourceFacts:[]}]
 }));
 const briefs=buildAgentBoundaryBriefs({controls});
 assert.equal(briefs.length,2);
 assert.equal(briefs[0].candidateRequirements,0);
 assert.equal(briefs[0].observedToolReferenceMetadata,false);
 assert.match(briefs[0].interpretation,/does not demonstrate/);
});
test('tools count originates only from matching artifact digest',()=>{
 const digest='f'.repeat(64);
 const controls=[{controlId:'ARL-KB-053',reviewRequirements:[{artifactDigests:[digest],
  boundedSourceFacts:[{artifactSha256:digest,values:{mcpAndToolReferenceFilesCount:20,
   discoveryCoverage:{completeTrackedAndTextScan:false}}},
  {artifactSha256:'e'.repeat(64),values:{mcpAndToolReferenceFilesCount:999}}]}]}];
 const [brief]=buildAgentBoundaryBriefs({controls});
 assert.equal(brief.toolReferenceCount,20);
 assert.equal(brief.limitedCoverage,true);
 assert.equal(brief.candidateRequirements,1);
});
