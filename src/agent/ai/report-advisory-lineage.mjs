import {validateStructuredAdvisory} from './structured-evidence-brief.mjs';

// Rebuild permissible references from the authoritative dossier, never from the AI response.
export function verifyReportAdvisory(dossier,advisory){
 if(advisory?.projectId!==dossier?.projectId||
   advisory?.snapshotId!==dossier?.snapshotId||
   advisory?.targetRevision!==dossier?.targetRevision||
   advisory?.advisoryOnly!==true||advisory?.humanReviewRequired!==true||
   advisory?.confirmedFinding!==false||advisory?.evidenceAccepted!==false||
   advisory?.securityStateChanged!==false||advisory?.deploymentDecisionWritten!==false)
   return false;
 const control=dossier.controls.find(c=>c.controlId===advisory.controlId);
 if(!control||!Array.isArray(advisory.structuredItems))return false;
 const facts=[{id:'F1'},{id:'F2'},{id:'F3'}];
 for(const [position,r] of control.reviewRequirements.entries()){
   const n=r.requirementIndex??position+1;
   facts.push({id:'R'+n});
   for(const [i,f] of (r.boundedSourceFacts||[]).entries()){
     if(!r.artifactDigests.includes(f.artifactSha256))return false;
     facts.push({id:'O'+n+'_'+(i+1),artifactSha256:f.artifactSha256});
   }
 }
 const check=validateStructuredAdvisory(JSON.stringify({
   schema:'arl.ai.evidence-brief.v1',items:advisory.structuredItems
 }),facts);
 return check.ok===true&&check.items.length===advisory.structuredItems.length&&
   check.items.every((item,index)=>
     JSON.stringify(item.artifactSha256)===
       JSON.stringify(advisory.structuredItems[index].artifactSha256));
}
