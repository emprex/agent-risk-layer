// Privacy-bounded facts from digest-verified source collections. No source text or secret data.
const countKeys=['trackedFileCount','dependencyCount','externalDestinationObservationCount','workloadIdentityCandidateCount'];
const arrayKeys=['observedTechnologies','providerPackageCandidates'];
const coverageKeys=['totalTrackedFiles','trackedFilesConsidered','textFilesAttempted','textFilesReadable','trackedFileScanCapped','textFileScanCapped','completeTrackedAndTextScan'];
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
    if(Object.keys(values).length)facts.push({collector,values});
  }
  return facts;
}
