import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sig=v=>crypto.createHash('sha256').update(v).digest('hex');
const safeId=v=>/^ARL-KB-\d{3}$/.test(v);
function validate(d){
  if(d?.schema!=='arl.agent.assessment-action-dossiers.v1'||d.controlsTotal!==108||
    d.controls?.length!==108||d.humanReviewRequired!==true||d.passFailInferred!==false||
    d.evidenceAccepted!==false||d.deploymentDecisionWritten!==false||
    d.securityStateChanged!==false||d.confirmedFindings!==0||
    d.remediationPlansIssued!==0||!/^[0-9a-f]{40}$/.test(d.targetRevision||'')||
    !d.snapshotId||!d.projectId||
    new Set(d.controls.map(c=>c.controlId)).size!==108||
    d.controls.some(c=>!safeId(c.controlId)||c.confirmedFinding!==false||
      c.result!=='undetermined'||!Array.isArray(c.reviewRequirements)||
      c.reviewRequirements.some(r=>r.proofStatus!=='not_validated'||r.requiresHumanDecision!==true)))
    throw new Error('Client pre-assessment requires complete, non-authoritative 108-control dossier.');
}
function actionText(r,lane){
  if(lane==='human_decision')
    return 'Obtain the authoritative, dated governance or approval record; check who approved it, for which scope and version, and record the accountable decision.';
  if(r.artifactDigests.length)
    return 'Open the referenced collected metadata and underlying primary source; compare it to the exact requirement; record what is observed, what is not established and whether an authorised runtime test is needed.';
  return 'Request the specified primary evidence from the system owner. Confirm applicability and scope. Where static evidence cannot settle the question, obtain written authorisation before testing.';
}
function controlCard(c){
  const candidate=c.reviewRequirements.filter(r=>r.artifactDigests.length).length;
  const outstanding=c.reviewRequirements.length-candidate;
  return `<article class="control" id="${escape(c.controlId)}"><div class="controlhead"><h3>${escape(c.title)}</h3><code>${escape(c.controlId)}</code></div>
  <p class="category">${escape(c.category)} · ${c.workflowLane==='human_decision'?'Decision-stage review':'Technical evidence review'}</p>
  <p><strong>What this checks.</strong> ${escape(c.purpose)}</p>
  <p><strong>How to assess.</strong> ${escape(c.assessmentMethod)}</p>
  <p><strong>Evidence state.</strong> ${candidate} requirement(s) have matching static metadata; ${outstanding} have no matching static metadata in the bounded collection. These counts are not compliance results.</p>
  <p><strong>Next accountable action.</strong> ${escape(c.nextStep)}</p>
  <details><summary>Evidence requirements, traceability and verification steps (${c.reviewRequirements.length})</summary>
  <div class="reqs">${c.reviewRequirements.map(r=>`<div class="req"><p><strong>Required:</strong> ${escape(r.expectedEvidence)}</p>
  <p><strong>Current state:</strong> ${r.artifactDigests.length?'Static metadata candidate':'No exact static metadata match'}; not validated.</p>
  ${r.artifactDigests.length?`<p><strong>Artifact SHA-256:</strong> <code>${r.artifactDigests.map(escape).join(', ')}</code></p>`:''}
  <p><strong>Action:</strong> ${escape(actionText(r,c.workflowLane))}</p>
  <p><strong>Completion condition:</strong> ${escape(r.acceptanceCriterion)}</p></div>`).join('')}</div></details></article>`;
}
export function renderClientPreassessment(d){
 validate(d);
 const candidate=d.candidateRequirementCount,remaining=d.requiresEvidenceOrReviewCount;
 const grouped=new Map();
 for(const c of d.controls){let a=grouped.get(c.category);if(!a){a=[];grouped.set(c.category,a);}a.push(c);}
 const categories=[...grouped.entries()].map(([cat,cs])=>{
   const unmet=cs.reduce((n,c)=>n+c.reviewRequirements.filter(r=>!r.artifactDigests.length).length,0);
   const observed=cs.reduce((n,c)=>n+c.reviewRequirements.filter(r=>r.artifactDigests.length).length,0);
   return {cat,cs,unmet,observed};
 });
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>AgentRiskLayer | Evidence pre-assessment</title>
 <style>
 :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#17283b;background:#eaf0f3}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:0 auto;min-height:100vh;padding:44px 58px;background:white;box-shadow:0 10px 50px #1232}h1{font-size:34px;letter-spacing:-.025em;line-height:1.15;margin:16px 0}h2{font-size:22px;margin-top:46px;border-top:1px solid #d4dee7;padding-top:22px;color:#163858}h3{font-size:19px;margin:0}.top{display:flex;justify-content:space-between;align-items:center;gap:18px}.brand{font-size:15px;font-weight:850;letter-spacing:.12em;color:#18476f}.tag{font-size:12px;font-weight:700;color:#81551d;background:#fff5e5;padding:8px 11px;border-radius:5px}p{line-height:1.65}.muted,.category{color:#53667a}.lede{font-size:19px;max-width:820px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:30px 0}.metric{padding:18px;background:#eff5f8;border-radius:8px;font-size:12px;color:#455a6d}.metric b{display:block;font-size:27px;color:#162f47;margin-bottom:4px}.notice{border-left:4px solid #c18439;padding:13px 18px;background:#fff9ed}.outline{border-left:4px solid #235b80;padding:14px 18px;background:#edf5fa}.categoryblock{padding:15px 0;border-bottom:1px solid #dee6eb}.categoryblock a{color:#16577b;text-decoration:none}.categoryblock a:hover{text-decoration:underline}.categoryblock b{display:block}.control{padding:22px 0;border-top:1px solid #d9e3ea}.controlhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.controlhead code{white-space:nowrap}code{font-size:11px;overflow-wrap:anywhere}.category{font-size:12px;font-weight:600}details{margin-top:15px;padding:12px 15px;background:#f2f6f9;border-radius:6px}summary{cursor:pointer;font-weight:650}.req{background:white;border:1px solid #dee7ed;border-radius:5px;padding:10px 14px;margin:10px 0}.req p{margin:8px 0;font-size:13px}.small{font-size:12px}.toolbar{margin-bottom:24px}.toolbar button{background:#18476f;color:white;border:0;padding:10px 16px;border-radius:5px;cursor:pointer}.foot{margin-top:50px;padding-top:20px;border-top:2px solid #24496b;color:#53667a}.anchor{scroll-margin-top:20px}@media(max-width:720px){main{padding:20px}.metrics{grid-template-columns:repeat(2,1fr)}.top{flex-direction:column;align-items:start}}@media print{body{background:white}main{box-shadow:none;max-width:none;padding:0}.toolbar{display:none}details{display:block}details>summary{display:none}details>*{display:block!important}.control{break-inside:auto}.req{break-inside:avoid}@page{size:A4;margin:16mm}}
 </style></head><body><main>
 <div class="toolbar"><button type="button" onclick="document.querySelectorAll('details').forEach(e=>e.open=true);window.print()">Print / Save PDF with appendix</button></div>
 <div class="top"><div class="brand">AGENTRISKLAYER LTD</div><span class="tag">EVIDENCE PRE-ASSESSMENT · HUMAN REVIEW REQUIRED</span></div>
 <h1>AI Agent Security<br>Evidence Pre-assessment</h1>
 <p class="lede">A decision-focused inventory of the security questions examined, the evidence currently available, and the steps needed to reach defensible findings.</p>
 <p class="small muted">This is not a completed penetration test, vulnerability assessment verdict, compliance certification or deployment approval. It is a structured pre-assessment requiring accountable human review.</p>
 <div class="metrics"><div class="metric"><b>108</b>Controls in scope</div><div class="metric"><b>${escape(candidate)}</b>Requirements with candidate metadata</div><div class="metric"><b>${escape(remaining)}</b>Requirements needing more evidence or review</div><div class="metric"><b>0</b>Confirmed findings in this export</div></div>
 <div class="notice"><strong>What the results mean.</strong> An observed metadata match means only that relevant static source material was collected and integrity checked. It does not mean a safeguard works. The absence of a metadata match is not a vulnerability. No active test, risk severity determination or final evidence acceptance is claimed by this report.</div>
 <h2>1. What has been done</h2><p>The frozen Git revision and current assessment snapshot are used to bind a read-only inventory of control definitions, expected evidence and cryptographically checked deterministic collection artifacts. ${escape(d.requirementsTotal)} individual evidence requirements are listed below. ${escape(d.controlsTotal)} control review dossiers are assembled for accountable assessment.</p>
 <h2>2. What the client should do next</h2>
 <p><strong>Confirm governance.</strong> Supply approved scope, business purpose, risk ownership, trust-boundary diagrams, data-handling policies and relevant decision records. The decision-stage controls need named human validation, not a code-only inference.</p>
 <p><strong>Validate source-derived observations.</strong> For each matching static item, review the actual primary source, compare the observed implementation with its requirement and document evidence limitations. A source-file inventory alone cannot demonstrate operational effectiveness.</p>
 <p><strong>Authorise targeted technical tests.</strong> Where applicable, agree rules of engagement for runtime checks of tool permissions, MCP interactions, data access, prompt-injection boundaries and approval enforcement. Do not execute them without scope and authorisation.</p>
 <p><strong>Issue findings only after substantiation.</strong> If a control failure is actually demonstrated, record reproducible evidence, affected asset and exact revision, technical cause, contextual impact and a reviewer-approved fix with an exact retest criterion. No such finding is automatically created here.</p>
 <h2>3. Review work organised by security area</h2>
 <p class="small muted">This list is ordered by knowledge category, not implied risk or severity. Review priority requires the client's environment and accountable assessment.</p>
 ${categories.map((g,i)=>`<div class="categoryblock"><a href="#area-${i}"><b>${escape(g.cat)} — ${g.cs.length} controls</b></a><span class="small muted">${g.observed} requirements have static metadata candidates; ${g.unmet} have no static match.</span></div>`).join('')}
 <h2>4. Findings and remediation status</h2><div class="outline"><strong>No confirmed security findings are represented in this assessment export.</strong> The worklist below is for evidence validation and further assessment, not vulnerability remediation. Generating a list of patches without validated causes and impacts would be misleading.</div>
 <h2>5. Detailed evidence and action register</h2>
 ${categories.map((g,i)=>`<section id="area-${i}" class="anchor"><h2>${escape(g.cat)}</h2><p class="small muted">${g.cs.length} controls · ${g.observed} candidate evidence requirements · ${g.unmet} without matching metadata</p>${g.cs.map(controlCard).join('')}</section>`).join('')}
 <h2>6. Scope and verification references</h2><p class="small"><strong>Project:</strong> ${escape(d.projectId)}<br><strong>Snapshot:</strong> ${escape(d.snapshotId)}<br><strong>Frozen target Git SHA:</strong> <code>${escape(d.targetRevision)}</code></p>
 <p class="small">Cryptographic digests in the register bind stored bytes to the assessed scope; they do not certify the accuracy, completeness or security effect of the content. Human validation and separately authorised execution remain required. This document makes no OWASP certification, UKAS accreditation, readiness or compliance claim.</p>
 <p class="foot small">AgentRiskLayer · Pre-assessment draft · Not approved for external release without accountable reviewer sign-off.</p>
 </main></body></html>`;
}
export function writeClientPreassessment({dossier,outputDirectory}){
 const html=renderClientPreassessment(dossier);
 const digest=sig(html);
 const root=path.resolve(outputDirectory);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const filename=`arl-client-preassessment-${dossier.targetRevision.slice(0,12)}-${digest.slice(0,12)}.html`;
 const file=path.join(root,filename);
 let status='created';
 try{
   const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   try{fs.writeFileSync(fd,html,'utf8');}finally{fs.closeSync(fd);}
 }catch(e){
   if(e.code!=='EEXIST')throw e;
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||sig(fs.readFileSync(file))!==digest)
     throw new Error('Existing client report differs; refusing overwrite.',{cause:e});
   status='already_present_identical';
 }
 return {file,status,sha256:digest};
}
