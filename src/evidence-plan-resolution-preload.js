import http from 'node:http';
import { db, insertEvent, nowIso } from './db.js';
import { getUserFromRequest } from './auth.js';
import { cleanText, verifyCsrf } from './security.js';

const originalCreateServer = http.createServer.bind(http);
const VALID_PLAN_IDS = new Set(['mcp-authority','approval-binding','memory-isolation','egress-boundary','containment-recovery','audit-reconstruction']);
const VALID_STATES = new Set(['not-applicable','evidence-gap']);
const VALID_DEPLOYMENT_DECISIONS = new Set(['proceed','hold','do_not_deploy']);

function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'private, no-store'});res.end(body);}
async function readJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Object.assign(new Error('Request body is too large.'),{statusCode:413});}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('Invalid JSON body.'),{statusCode:400});}}
async function ownerAssessment(req,res,assessmentId){
 const user=await getUserFromRequest(req);if(!user){json(res,401,{error:'Sign in is required.'});return null;}if(!user.emailVerified){json(res,403,{error:'Verify your email before changing assessment evidence.'});return null;}if(!verifyCsrf(req)){json(res,403,{error:'Security token missing or invalid. Refresh the page and try again.'});return null;}
 const row=await db.prepare('SELECT id,user_id,result_json FROM assessments WHERE id = ?').get(assessmentId);if(!row||row.user_id!==user.id){json(res,404,{error:'Assessment not found.'});return null;}
 let result;try{result=JSON.parse(row.result_json||'{}');}catch{json(res,500,{error:'Assessment result data could not be read safely.'});return null;}
 return {user,row,result};
}
function arrayCount(value){return Array.isArray(value)?value.length:0;}
function proceedBlockers(result={}){
 const resolutions=result.evidencePlanResolutions&&typeof result.evidencePlanResolutions==='object'&&!Array.isArray(result.evidencePlanResolutions)?result.evidencePlanResolutions:{};
 const recordedEvidenceGaps=Object.values(resolutions).filter((item)=>item?.state==='evidence-gap').length;
 const informationGaps=Math.max(arrayCount(result.unresolvedItems),arrayCount(result.blockingInformationGaps));
 const unresolvedEvidenceQuestions=arrayCount(result.blockingEvidenceGaps);
 const confirmedRuntimeFailures=arrayCount(result.redTeam?.failedResults);
 return {recordedEvidenceGaps,informationGaps,unresolvedEvidenceQuestions,confirmedRuntimeFailures,blocked:Boolean(recordedEvidenceGaps||informationGaps||unresolvedEvidenceQuestions||confirmedRuntimeFailures)};
}
async function handleResolution(req,res,assessmentId){
 const owned=await ownerAssessment(req,res,assessmentId);if(!owned)return;
 const {user,row,result}=owned;
 const body=await readJson(req),planId=cleanText(body.planId,80),state=cleanText(body.state,40),rationale=cleanText(body.rationale,3000);
 if(!VALID_PLAN_IDS.has(planId))return json(res,400,{error:'Unknown evidence-plan question.'});if(!VALID_STATES.has(state))return json(res,400,{error:'Unsupported evidence-plan disposition.'});if(rationale.length<20)return json(res,400,{error:'Add a specific evidence-based rationale of at least 20 characters.'});
 const recordedAt=nowIso(),previous=result.evidencePlanResolutions&&typeof result.evidencePlanResolutions==='object'&&!Array.isArray(result.evidencePlanResolutions)?result.evidencePlanResolutions:{};
 const resolution={state,rationale,reviewerUserId:user.id,recordedAt};result.evidencePlanResolutions={...previous,[planId]:resolution};
 await db.prepare('UPDATE assessments SET result_json = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(result),recordedAt,assessmentId,user.id);
 await insertEvent(state==='not-applicable'?'evidence_plan_not_applicable_recorded':'evidence_plan_gap_recorded',user.id,{assessmentId,planId,state,recordedAt});
 return json(res,200,{resolution});
}
async function handleDeploymentDecision(req,res,assessmentId){
 const owned=await ownerAssessment(req,res,assessmentId);if(!owned)return;
 const {user,result}=owned;
 const body=await readJson(req),decision=cleanText(body.decision,40).toLowerCase(),rationale=cleanText(body.rationale,3000);
 if(!VALID_DEPLOYMENT_DECISIONS.has(decision))return json(res,400,{error:'Choose Proceed, Hold or Do not deploy.'});
 if(rationale.length<20)return json(res,400,{error:'Record the evidence-based rationale for this deployment decision (at least 20 characters).'});
 const blockers=proceedBlockers(result);
 if(decision==='proceed'&&blockers.blocked)return json(res,409,{error:'Proceed cannot be recorded while material information gaps, evidence gaps or confirmed bounded-test failures remain.',blockers});
 const recordedAt=nowIso();
 const deploymentDecision={decision,rationale,reviewerUserId:user.id,recordedAt,blockersAtDecision:blockers};
 result.deploymentDecision=deploymentDecision;
 await db.prepare('UPDATE assessments SET result_json = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(result),recordedAt,assessmentId,user.id);
 await insertEvent('assessment_deployment_decision_recorded',user.id,{assessmentId,decision,recordedAt,blockers});
 return json(res,200,{deploymentDecision});
}
http.createServer=function createServerWithEvidencePlanResolution(listener){return originalCreateServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 const resolutionMatch=url.pathname.match(/^\/api\/assessments\/([^/]+)\/evidence-plan\/resolutions$/);
 if(req.method==='POST'&&resolutionMatch)return await handleResolution(req,res,decodeURIComponent(resolutionMatch[1]));
 const decisionMatch=url.pathname.match(/^\/api\/assessments\/([^/]+)\/deployment-decision$/);
 if(req.method==='POST'&&decisionMatch)return await handleDeploymentDecision(req,res,decodeURIComponent(decisionMatch[1]));
 }catch(error){return json(res,error.statusCode||500,{error:error.message||'Could not update assessment evidence.'});}return listener(req,res);});};
