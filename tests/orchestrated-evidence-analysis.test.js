import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSourceObservationFacts} from '../src/agent/ai/source-observation-facts.mjs';
import {explainControlObservation} from '../src/agent/ai/control-observation-analyst.mjs';
test('collector projects only privacy-bounded observation fields',()=>{
 const f=extractSourceObservationFacts({architecture_and_inventory:{dependencyCount:7,observedTechnologies:['node','<secret>'],externalDestinationObservations:[{destinationHash:'aaa'}],secret:'PRIVATE',discoveryCoverage:{completeTrackedAndTextScan:false}}});
 assert.equal(f[0].values.dependencyCount,7);
 assert.equal(f[0].values.externalDestinationObservationsCount,1);
 assert.deepEqual(f[0].values.observedTechnologies,['node']);
 assert.equal(JSON.stringify(f).includes('PRIVATE'),false);
 assert.equal(f[0].values.discoveryCoverage.completeTrackedAndTextScan,false);
});
function dossier(){
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),title:'Control '+i,purpose:'Assess boundary',assessmentMethod:'Review configuration',confirmedFinding:false,result:'undetermined',reviewRequirements:[{requirementIndex:1,expectedEvidence:'Versioned evidence',artifactDigests:['a'.repeat(64)],boundedSourceFacts:[{collector:'architecture_and_inventory',artifactSha256:'a'.repeat(64),values:{dependencyCount:7}}]}]}));
 return {schema:'arl.agent.assessment-action-dossiers.v1',controlsTotal:108,targetRevision:'b'.repeat(40),humanReviewRequired:true,passFailInferred:false,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false,controls};
}
test('AI analysis gets bounded facts, does not create verdicts',async()=>{
 let observed;
 const result=await explainControlObservation({dossier:dossier(),controlId:'ARL-KB-001',ask:async q=>(observed=q,{available:true,model:'fixture',content:"{\"schema\":\"arl.ai.evidence-brief.v1\",\"items\":[{\"type\":\"observation\",\"text\":\"Metadata includes a dependency count of seven.\",\"factIds\":[\"O1_1\"],\"artifactSha256\":[\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]}]}"})});
 assert.equal(result.available,true);
 assert.equal(result.confirmedFinding,false);
 assert.equal(result.advisoryOnly,true);
 assert.match(observed.messages[1].content,/dependencyCount/);
});
test('uncited, unknown references and missing Ollama fail closed',async()=>{
 const a=await explainControlObservation({dossier:dossier(),controlId:'ARL-KB-001',ask:async()=>({available:true,content:'Evidence definitely works.'})});
 assert.equal(a.available,false);
 const b=await explainControlObservation({dossier:dossier(),controlId:'ARL-KB-001',ask:async()=>({available:true,content:'Some fact [FAKE].'})});
 assert.equal(b.available,false);
 const c=await explainControlObservation({dossier:dossier(),controlId:'ARL-KB-001',ask:async()=>({available:false,reason:'ollama_unavailable'})});
 assert.equal(c.reason,'ollama_unavailable');
});
