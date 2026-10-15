import {collectControlEvidence} from './control-evidence-selection.mjs';
export function buildKb007Brief(dossier) {
 const evidence=collectControlEvidence(dossier,'ARL-KB-007');
 if(!evidence)return null;
 const sourceFacts=evidence.facts;
 const providers = [...new Set(sourceFacts.flatMap(f =>
  Array.isArray(f.values?.providerPackageCandidates) ? f.values.providerPackageCandidates : []
 ).filter(v => typeof v === 'string' && /^[a-z0-9._-]{1,60}$/i.test(v)))].sort().slice(0,24);
 const limited=evidence.limitedCoverage;
 return { providers, limitedCoverage:limited, controlId:'ARL-KB-007',
  candidateRequirements:evidence.candidateRequirements,
  checks:[
   'Reconcile candidate packages against active runtime providers and MCP connections.',
   'Obtain accountable approval, purpose, data destinations and boundaries for each active provider.',
   'Review disabled or dormant integrations and change-control or disablement evidence.'
  ]};
}
