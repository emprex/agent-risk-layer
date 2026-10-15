import {collectControlEvidence} from './control-evidence-selection.mjs';
const DEFINITIONS={
 'ARL-KB-031':{
  title:'Direct prompt-injection boundary',
  checks:[
   'Identify the independently enforced policy and tool-execution boundary.',
   'Request written rules of engagement for synthetic instruction-conflict and role-spoofing cases.',
   'Correlate allowed and denied tool effects with policy decisions and attributable audit records.'
  ]},
 'ARL-KB-053':{
  title:'Agent tool and credential authority',
  checks:[
   'Reconcile MCP and tool source references with the actual runtime tool catalogue.',
   'Compare allowed operations and credential scopes against approved task requirements.',
   'Request authorised least-privilege tests for unused or excessive tool capabilities.'
  ]}
};
export function buildAgentBoundaryBriefs(dossier){
 const result=[];
 for(const [controlId,definition] of Object.entries(DEFINITIONS)){
  const evidence=collectControlEvidence(dossier,controlId);
  if(!evidence)continue;
  const facts=evidence.facts;
  const count=Math.max(0,...facts.map(f=>Number.isSafeInteger(f.values?.mcpAndToolReferenceFilesCount)?
   f.values.mcpAndToolReferenceFilesCount:0));
  const references=facts.filter(f=>Number.isSafeInteger(f.values?.mcpAndToolReferenceFilesCount)).length;
  const capped=evidence.limitedCoverage;
  result.push({controlId,...definition,
   candidateRequirements:evidence.candidateRequirements,
   totalRequirements:evidence.totalRequirements,toolReferenceCount:count,
   observedToolReferenceMetadata:references>0,limitedCoverage:capped,
   interpretation:'Static metadata indicates collection candidates only; it does not demonstrate runtime policy enforcement, exploitable prompt injection or excessive authority.'});
 }
 return result;
}
