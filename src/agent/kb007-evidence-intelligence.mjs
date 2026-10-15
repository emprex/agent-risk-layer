export function buildKb007Brief(dossier) {
 const control = dossier?.controls?.find(c => c.controlId === 'ARL-KB-007');
 if (!control) return null;
 const sourceFacts = control.reviewRequirements.flatMap(r =>
  (r.boundedSourceFacts || []).filter(f => r.artifactDigests.includes(f.artifactSha256)));
 const providers = [...new Set(sourceFacts.flatMap(f =>
  Array.isArray(f.values?.providerPackageCandidates) ? f.values.providerPackageCandidates : []
 ).filter(v => typeof v === 'string' && /^[a-z0-9._-]{1,60}$/i.test(v)))].sort().slice(0,24);
 const limited = sourceFacts.some(f => f.values?.discoveryCoverage?.completeTrackedAndTextScan === false);
 return { providers, limitedCoverage:limited, controlId:'ARL-KB-007',
  candidateRequirements:control.reviewRequirements.filter(r => r.artifactDigests.length).length,
  checks:[
   'Reconcile candidate packages against active runtime providers and MCP connections.',
   'Obtain accountable approval, purpose, data destinations and boundaries for each active provider.',
   'Review disabled or dormant integrations and change-control or disablement evidence.'
  ]};
}
