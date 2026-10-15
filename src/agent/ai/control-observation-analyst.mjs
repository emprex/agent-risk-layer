import {validateStructuredAdvisory,renderStructuredAdvisory} from './structured-evidence-brief.mjs';
import {askLocalOllama} from './ollama-client.mjs';

// Advisory text cannot become a finding or mutate authoritative ARL state.
export async function explainControlObservation({dossier,controlId,ask=askLocalOllama}){
 if(dossier?.schema!=='arl.agent.assessment-action-dossiers.v1'||
   dossier.humanReviewRequired!==true||dossier.passFailInferred!==false||
   dossier.evidenceAccepted!==false||dossier.securityStateChanged!==false||
   dossier.deploymentDecisionWritten!==false||dossier.controlsTotal!==108||
   !/^[a-f0-9]{40}$/.test(dossier.targetRevision||''))
   throw new Error('Grounded analysis requires a decision-free exact-scope dossier.');
 const c=dossier.controls?.find(c=>c.controlId===controlId);
 if(!c||c.confirmedFinding!==false||c.result!=='undetermined')
   throw new Error('Requested control is unavailable or authoritative.');
 const facts=[{id:'F1',text:'Control '+c.controlId+': '+c.title},
   {id:'F2',text:'Assessment objective: '+c.purpose},
   {id:'F3',text:'Assessment method: '+c.assessmentMethod}];
 for(const r of c.reviewRequirements){
   const n=r.requirementIndex;
   facts.push({id:'R'+n,text:'Required evidence: '+r.expectedEvidence+'; status: '+(r.artifactDigests.length?'static metadata candidate, not validated':'no static metadata match, not validated')});
   for(const [i,f] of (r.boundedSourceFacts||[]).slice(0,4).entries()){
     facts.push({id:'O'+n+'_'+(i+1),artifactSha256:f.artifactSha256,text:'Unvalidated source metadata collected by '+f.collector+'; SHA256 '+f.artifactSha256+'; bounded fields: '+JSON.stringify(f.values)});
   }
 }
 // The model receives only bounded facts. ARL owns all full digests and lineage.
 const selected=facts.filter(f=>/^O\d+_\d+$/.test(f.id)).slice(0,3);
 const requirements=facts.filter(f=>/^R\d+$/.test(f.id)).slice(0,3);
 const compact=[...selected,...requirements].map(f=>({
   id:f.id,text:f.text.replace(/; SHA256 [a-f0-9]{64}/g,'').slice(0,380)
 }));
 const messages=[{role:'system',content:
   'Return JSON only: {"items":[{"type":"observation","text":"short factual claim","factIds":["O1_1"]},{"type":"verification","text":"concrete next check","factIds":["R1"]}]}. '+
   'At most 3 items, 25 words per text. Only supplied factIds. No findings, verdicts, severity, or assumed missing controls. '+
   'Observations are unvalidated metadata, not runtime proof. If no O fact exists, use limitation and verification.'},
   {role:'user',content:JSON.stringify({controlId,facts:compact})}];
 const result=await ask({messages,jsonMode:true,maxOutputTokens:320,timeoutMs:90000});
 if(result?.available!==true)return {available:false,reason:result?.reason||'ai_unavailable',controlId,facts,advisoryOnly:true};
 const answer=String(result.content||'').trim();
 const checked=validateStructuredAdvisory(answer,facts);
 if(!checked.ok && checked.reason==='invalid_json')return {available:false,reason:'ollama_invalid_json_response',controlId,facts,advisoryOnly:true};
 if(!checked.ok)return {available:false,reason:checked.reason,controlId,facts,advisoryOnly:true};
 return {available:true,controlId,projectId:dossier.projectId,snapshotId:dossier.snapshotId,targetRevision:dossier.targetRevision,model:result.model||null,analysis:renderStructuredAdvisory(checked.items),structuredItems:checked.items,facts,advisoryOnly:true,
   confirmedFinding:false,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false,
   humanReviewRequired:true};
}
