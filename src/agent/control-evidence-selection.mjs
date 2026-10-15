// Shared, read-only evidence selection for any control and assessment dossier.
// Selection is per requirement: a digest in a different requirement never
// legitimises a source fact, even within the same control.
const isDigest = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
export function collectControlEvidence(dossier,controlId){
 const control=dossier?.controls?.find(c=>c.controlId===controlId);
 if(!control||!Array.isArray(control.reviewRequirements))return null;
 const requirements=control.reviewRequirements.map((requirement,index)=>{
  const artifactDigests=[...new Set((Array.isArray(requirement.artifactDigests)?
   requirement.artifactDigests:[]).filter(isDigest))];
  const eligible=new Set(artifactDigests);
  const facts=(Array.isArray(requirement.boundedSourceFacts)?
   requirement.boundedSourceFacts:[]).filter(f=>f&&
    isDigest(f.artifactSha256)&&eligible.has(f.artifactSha256));
  return {requirementIndex:requirement.requirementIndex??index+1,
   requirement,artifactDigests,facts};
 });
 const facts=requirements.flatMap(r=>r.facts);
 const coverages=facts.map(f=>f.values?.discoveryCoverage).filter(Boolean);
 return {controlId,control,requirements,facts,
  candidateRequirements:requirements.filter(r=>r.artifactDigests.length>0).length,
  totalRequirements:requirements.length,
  limitedCoverage:coverages.some(c=>c.completeTrackedAndTextScan===false||
   c.trackedFileScanCapped===true||c.textFileScanCapped===true)};
}
