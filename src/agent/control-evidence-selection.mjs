// Shared, read-only evidence selection for any control and any assessment dossier.
// A source fact is eligible only when its digest belongs to its own requirement.
export function collectControlEvidence(dossier, controlId) {
 const control=dossier?.controls?.find(c=>c.controlId===controlId);
 if(!control||!Array.isArray(control.reviewRequirements))return null;
 const facts=control.reviewRequirements.flatMap(r=>
  (r.boundedSourceFacts||[]).filter(f=>
   typeof f.artifactSha256==='string'&&
   Array.isArray(r.artifactDigests)&&r.artifactDigests.includes(f.artifactSha256)));
 const coverages=facts.map(f=>f.values?.discoveryCoverage).filter(Boolean);
 return {controlId,control,facts,
  candidateRequirements:control.reviewRequirements.filter(r=>Array.isArray(r.artifactDigests)&&r.artifactDigests.length>0).length,
  totalRequirements:control.reviewRequirements.length,
  limitedCoverage:coverages.some(c=>c.completeTrackedAndTextScan===false||
   c.trackedFileScanCapped===true||c.textFileScanCapped===true)};
}
