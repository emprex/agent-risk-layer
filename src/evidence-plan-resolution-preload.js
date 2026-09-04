import http from 'node:http';
import { db, insertEvent, nowIso } from './db.js';
import { getUserFromRequest } from './auth.js';
import { cleanText, verifyCsrf } from './security.js';

const originalCreateServer = http.createServer.bind(http);
const VALID_PLAN_IDS = new Set(['mcp-authority','approval-binding','memory-isolation','egress-boundary','containment-recovery','audit-reconstruction']);
const VALID_STATES = new Set(['not-applicable','evidence-gap']);
function json(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'private, no-store'});res.end(body);}
async function readJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Object.assign(new Error('Request body is too large.'),{statusCode:413});}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('Invalid JSON body.'),{statusCode:400});}}
async function handleResolution(req,res,assessmentId){
 const user=await getUserFromRequest(req);if(!user)return json(res,401,{error:'Sign in is required.'});if(!user.emailVerified)return json(res,403,{error:'Verify your email before changing assessment evidence.'});if(!verifyCsrf(req))return json(res,403,{error:'Security token missing or invalid. Refresh the page and try again.'});
 const row=await db.prepare('SELECT id,user_id,result_json FROM assessments WHERE id = ?').get(assessmentId);if(!row||row.user_id!==user.id)return json(res,404,{error:'Assessment not found.'});
 const body=await readJson(req),planId=cleanText(body.planId,80),state=cleanText(body.state,40),rationale=cleanText(body.rationale,3000);
 if(!VALID_PLAN_IDS.has(planId))return json(res,400,{error:'Unknown evidence-plan question.'});if(!VALID_STATES.has(state))return json(res,400,{error:'Unsupported evidence-plan disposition.'});if(rationale.length<20)return json(res,400,{error:'Add a specific evidence-based rationale of at least 20 characters.'});
 let result;try{result=JSON.parse(row.result_json||'{}');}catch{return json(res,500,{error:'Assessment result data could not be read safely.'});}
 const recordedAt=nowIso(),previous=result.evidencePlanResolutions&&typeof result.evidencePlanResolutions==='object'&&!Array.isArray(result.evidencePlanResolutions)?result.evidencePlanResolutions:{};
 const resolution={state,rationale,reviewerUserId:user.id,recordedAt};result.evidencePlanResolutions={...previous,[planId]:resolution};
 await db.prepare('UPDATE assessments SET result_json = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(result),recordedAt,assessmentId,user.id);
 await insertEvent(state==='not-applicable'?'evidence_plan_not_applicable_recorded':'evidence_plan_gap_recorded',user.id,{assessmentId,planId,state,recordedAt});
 return json(res,200,{resolution});
}
http.createServer=function createServerWithEvidencePlanResolution(listener){return originalCreateServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),match=url.pathname.match(/^\/api\/assessments\/([^/]+)\/evidence-plan\/resolutions$/);if(req.method==='POST'&&match)return await handleResolution(req,res,decodeURIComponent(match[1]));}catch(error){return json(res,error.statusCode||500,{error:error.message||'Could not record evidence-plan resolution.'});}return listener(req,res);});};
