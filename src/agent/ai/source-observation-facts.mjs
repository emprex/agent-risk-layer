// Privacy-bounded facts from digest-verified source collections. No source text or secret data.
const countKeys=['trackedFileCount','dependencyCount','externalDestinationObservationCount','workloadIdentityCandidateCount'];
const arrayKeys=['observedTechnologies','providerPackageCandidates'];
// Stable, privacy-preserving source locators from the persisted frozen-source
// artifact. Never release the raw file path, URL, credential or source content.
// Each locator is a candidate to locate and review, not accepted control proof.
const referenceKeys=Object.freeze({
 architectureArtifacts:'architecture',
 policyArtifacts:'policy',
 configurationArtifacts:'configuration',
 ciCdArtifacts:'ci_cd',
 mcpAndToolReferenceFiles:'mcp_tool',
 credentialReferenceFiles:'credential_reference',
 externalDestinationObservations:'outbound_destination',
 lockfiles:'lockfile',
 packageManifests:'package_manifest'
});
const HEX24=/^[a-f0-9]{24}$/;
function boundedReferenceSamples(record){
 const seen=new Set(),results=[];
 for(const [name,kind] of Object.entries(referenceKeys)){
  if(!Array.isArray(record[name]))continue;
  for(const ref of record[name]){
   const hash=name==='externalDestinationObservations'?ref?.destinationHash:ref?.pathHash;
   if(typeof hash!=='string'||!HEX24.test(hash))continue;
   const key=kind+':'+hash;
   if(seen.has(key))continue;
   seen.add(key);
   if(results.length<12)results.push({kind,hash});
  }
 }
 return results;
}
const coverageKeys=['totalTrackedFiles','trackedFilesConsidered','textFilesAttempted','textFilesReadable','trackedFileScanCapped','textFileScanCapped','textFilesSkippedForByteBudget','textBytesRead','textByteBudget','completeTrackedAndTextScan'];
export function extractSourceObservationFacts(observations){
  const facts=[];
  if(!observations||typeof observations!=='object'||Array.isArray(observations))return facts;
  for(const [collector,record] of Object.entries(observations)){
    if(!record||typeof record!=='object'||Array.isArray(record))continue;
    const values={};
    for(const k of countKeys)if(Number.isSafeInteger(record[k])&&record[k]>=0)values[k]=record[k];
    for(const k of arrayKeys)if(Array.isArray(record[k]))values[k]=record[k].filter(v=>typeof v==='string'&&/^[a-z0-9 ._+@/-]{1,100}$/i.test(v)).slice(0,12);
    if(record.discoveryCoverage&&typeof record.discoveryCoverage==='object'){
      const coverage={};
      for(const k of coverageKeys){const v=record.discoveryCoverage[k];if(typeof v==='boolean'||Number.isSafeInteger(v)&&v>=0)coverage[k]=v;}
      if(Object.keys(coverage).length)values.discoveryCoverage=coverage;
    }
    for(const k of ['architectureArtifacts','policyArtifacts','configurationArtifacts','ciCdArtifacts','mcpAndToolReferenceFiles','credentialReferenceFiles','externalDestinationObservations','lockfiles','packageManifests']){
      if(Array.isArray(record[k]))values[k+'Count']=record[k].length;
    }
    const references=boundedReferenceSamples(record);
    if(references.length)values.referenceSamples=references;
    if(Object.keys(values).length)facts.push({collector,values});
  }
  return facts;
}
