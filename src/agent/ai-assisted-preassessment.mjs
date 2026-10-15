import {explainControlObservation} from './ai/control-observation-analyst.mjs';
import {writeClientPreassessment} from './client-preassessment-export.mjs';

export const REPORT_PILOT_CONTROLS=Object.freeze(['ARL-KB-007','ARL-KB-031','ARL-KB-053']);

// One read-only orchestration boundary; no report silently masquerades as AI-assisted if every AI run failed.
export async function buildAiAssistedPreassessment({dossier,outputDirectory,ask}){
 const advisories=[],failures=[];
 for(const controlId of REPORT_PILOT_CONTROLS){
   const advisory=await explainControlObservation({dossier,controlId,...(ask?{ask}:{})});
   if(advisory.available===true)advisories.push(advisory);
   else failures.push({controlId,reason:advisory.reason});
 }
 if(!advisories.length)return {available:false,reason:'no_validated_structured_ai_briefs',
   failures,reportWritten:false,securityStateChanged:false,humanReviewRequired:true};
 const exported=writeClientPreassessment({dossier,advisories,outputDirectory});
 return {available:true,...exported,advisoryControlIds:advisories.map(a=>a.controlId),failures,
   reportWritten:true,securityStateChanged:false,humanReviewRequired:true};
}
