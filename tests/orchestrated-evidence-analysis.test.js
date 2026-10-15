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

test('compact model prompt omits SHA digests, limits output and reconstructs provenance',async()=>{
 let request;
 const content=JSON.stringify({items:[{type:'observation',text:'Static dependency count is seven.',factIds:['O1_1']},{type:'verification',text:'Review versioned primary evidence.',factIds:['R1']}]});
 const result=await explainControlObservation({dossier:dossier(),controlId:'ARL-KB-001',ask:async input=>{request=input;return {available:true,content};}});
 assert.equal(result.available,true);
 assert.equal(result.structuredItems[0].artifactSha256[0],'a'.repeat(64));
 assert.equal(request.maxOutputTokens,320);
 assert.equal(request.jsonMode,true);
 assert.equal(request.messages[1].content.includes('a'.repeat(64)),false);
 assert.match(request.messages[1].content,/dependencyCount/);
});


test('source evidence retains only typed, hashed locators and never raw source names or destinations',()=>{
 const token='a'.repeat(24),host='b'.repeat(24);
 const facts=extractSourceObservationFacts({
  source_and_configuration:{
   mcpAndToolReferenceFiles:[{pathHash:token,basename:'customer-private.js'},{pathHash:'BAD',basename:'secret'}],
   credentialReferenceFiles:[{pathHash:token,basename:'prod-secrets.env'}],
   externalDestinationObservations:[{destinationHash:host,observedIn:{basename:'external.example'}}],
   sensitiveRawContents:'SUPERTOKEN_DO_NOT_EXPOSE'
  }
 });
 assert.equal(facts.length,1);
 assert.deepEqual(facts[0].values.referenceSamples,[
  {kind:'mcp_tool',hash:token},{kind:'credential_reference',hash:token},
  {kind:'outbound_destination',hash:host}
 ]);
 const report=JSON.stringify(facts);
 for(const secret of ['customer-private.js','prod-secrets.env','external.example','SUPERTOKEN_DO_NOT_EXPOSE','BAD'])
  assert.equal(report.includes(secret),false);
});
