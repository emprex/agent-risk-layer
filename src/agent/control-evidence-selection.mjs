// Shared read-only evidence selection. A digest from another requirement
// must never legitimise a fact, including coverage metadata.
const isDigest = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);

// A complete bounded scan is not proof of complete runtime discovery.
function boundedScanCoverageState(facts){
 const records=facts.map(f=>f.values?.discoveryCoverage).filter(c=>
  c && typeof c==='object' && !Array.isArray(c));
 if(records.some(c=>c.completeTrackedAndTextScan===false||
  c.trackedFileScanCapped===true||c.textFileScanCapped===true))
  return 'limited_bounded_scan';
 if(records.length && records.every(c=>c.completeTrackedAndTextScan===true))
  return 'reported_complete_bounded_scan';
 return 'unknown';
}

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
  const boundedScanState=boundedScanCoverageState(facts);
  return {requirementIndex:requirement.requirementIndex??index+1,
   requirement,artifactDigests,facts,boundedScanCoverageState:boundedScanState,
   limitedCoverage:boundedScanState==='limited_bounded_scan'};
 });
 const facts=requirements.flatMap(r=>r.facts);
 return {controlId,control,requirements,facts,
  candidateRequirements:requirements.filter(r=>r.artifactDigests.length>0).length,
  totalRequirements:requirements.length,
  limitedCoverage:requirements.some(r=>r.limitedCoverage)};
}
