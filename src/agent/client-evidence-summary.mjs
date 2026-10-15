import {collectControlEvidence} from './control-evidence-selection.mjs';

// Deterministic, read-only client work summary. This is a review workload,
// never a security ranking. Only requirement-bound digests and facts may
// appear as observed candidate metadata in client-facing summaries.
export function buildClientEvidenceSummary(dossier,{limit=5}={}){
 if(dossier?.schema!=='arl.agent.assessment-action-dossiers.v1'||dossier.controlsTotal!==108||
    dossier.controls?.length!==108||dossier.passFailInferred!==false||
    dossier.evidenceAccepted!==false||dossier.securityStateChanged!==false||
    dossier.deploymentDecisionWritten!==false)
   throw new Error('Complete non-authoritative dossier required.');
 const items=dossier.controls.map(control=>{
   const evidence=collectControlEvidence(dossier,control.controlId);
   const candidate=evidence.requirements.filter(r=>r.artifactDigests.length>0);
   const sourceFacts=candidate.flatMap(r=>r.facts.map(f=>({
     collector:f.collector,values:f.values,digest:f.artifactSha256,
     requirement:r.requirement.expectedEvidence
   })));
   const missing=evidence.requirements.filter(r=>!r.artifactDigests.length);
   return {controlId:control.controlId,title:control.title,category:control.category,
     candidateCount:candidate.length,missingCount:missing.length,
     sourceFacts:sourceFacts.slice(0,3),
     verification:missing[0]?.requirement.expectedEvidence||
       candidate[0]?.requirement.expectedEvidence||null,
     decisionStage:control.workflowLane==='human_decision'};
 }).filter(x=>x.sourceFacts.length||x.missingCount);
 const technical=items.filter(x=>x.sourceFacts.length).sort((a,b)=>b.sourceFacts.length-a.sourceFacts.length||
   b.candidateCount-a.candidateCount||a.controlId.localeCompare(b.controlId));
 const governance=items.filter(x=>x.decisionStage&&x.missingCount).sort((a,b)=>a.controlId.localeCompare(b.controlId));
 return {technical:technical.slice(0,limit),governance:governance.slice(0,Math.min(3,limit)),
   method:'Illustrative evidence-review starting points, ordered by collected metadata and required human records; not security risk, impact or severity.'};
}
