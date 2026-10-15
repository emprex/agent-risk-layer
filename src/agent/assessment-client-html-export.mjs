import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function esc(v) { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function assertDraft(r) {
  if (r?.schema!=='arl.agent.assessment-client-report.v1' ||
      r.reportStatus!=='draft_requires_accountable_human_review' ||
      r.humanReviewRequired!==true || r.evidenceAccepted!==false ||
      r.passFailInferred!==false || r.securityStateChanged!==false ||
      r.deploymentDecisionWritten!==false ||
      r.summary?.totalControls!==108 || r.controls?.length!==108 ||
      new Set(r.controls.map(c=>c.controlId)).size!==108 ||
      !/^[a-f0-9]{40}$/.test(r.targetRevision||'') ||
      !r.systemSnapshotId || !r.projectId ||
      r.controls.some(c=>c.assessmentResult!=='not_determined' ||
        !/^ARL-KB-\d{3}$/.test(c.controlId))) {
    throw new Error('HTML export requires a complete, unapproved 108-control canonical draft.');
  }
}
export function renderAssessmentClientHtml(r) {
  assertDraft(r);
  const rows=r.controls.map(c=>`<section class="control"><h3>${esc(c.controlId)} <small>${esc(c.workflowLane)}</small></h3>
<p><b>Assessment:</b> Not determined. <b>Stored static artifacts:</b> ${esc(c.staticArtifacts)}. <b>Artifact integrity:</b> ${esc(c.artifactIntegrity)}.</p>
<p><b>Next action:</b> ${esc(c.nextAction)}</p>
<p><b>Lineage exceptions:</b> ${esc(c.lineageExceptionCount)}</p>
${c.criteria.length?`<table><thead><tr><th>Criterion #</th><th>Evidence category</th><th>Review state</th><th>Metadata state</th></tr></thead><tbody>${c.criteria.map(x=>`<tr><td>${esc(x.index)}</td><td>${esc(x.kind)}</td><td>${esc(x.reviewState)}</td><td>${esc(x.staticMetadataState||'—')}</td></tr>`).join('')}</tbody></table>`:'<p>No criterion details present in the current bounded dossier; human review required.</p>'}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARL Evidence Assessment — Draft</title><style>
:root{font-family:system-ui,Arial,sans-serif;color:#142337;background:#edf2f6}*{box-sizing:border-box}body{margin:0}main{max-width:980px;margin:auto;background:#fff;padding:42px;min-height:100vh}header{border-bottom:3px solid #24466e;padding-bottom:24px}h1{font-size:30px;margin:12px 0}h2{font-size:21px;margin-top:34px;color:#24466e}h3{margin-bottom:8px}.sub{color:#526579}.stamp{font-weight:750;letter-spacing:.08em;color:#9b4d12}.metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}.metric{flex:1;min-width:140px;padding:16px;background:#f1f5f9;border-radius:8px}.metric strong{display:block;font-size:24px}.control{border-top:1px solid #d4dce3;padding:12px 0;break-inside:avoid-page}.control small{font-size:12px;color:#637487;font-weight:400}table{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0}td,th{border:1px solid #d4dce3;text-align:left;padding:7px;overflow-wrap:anywhere}th{background:#edf2f6}li{margin:8px 0}.meta{overflow-wrap:anywhere;font-size:13px}.warn{padding:14px;border-left:4px solid #ab681d;background:#fff7eb}.toolbar{margin-bottom:18px}.toolbar button{padding:10px 18px;cursor:pointer}@media print{body{background:#fff}main{padding:0;max-width:none}.toolbar{display:none}@page{size:A4;margin:18mm}h2,h3{break-after:avoid-page}.control{break-inside:auto}}
</style></head><body><main><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div><header><div class="stamp">DRAFT • HUMAN REVIEW REQUIRED • NOT A SECURITY VERDICT</div><h1>AgentRiskLayer — AI Agent Security Evidence Assessment</h1><div class="sub">Local, read-only assessment dossier. Not for external release without accountable reviewer sign-off.</div><p class="meta"><b>Project:</b> ${esc(r.projectId)}<br><b>Snapshot:</b> ${esc(r.systemSnapshotId)}<br><b>Frozen Git revision:</b> ${esc(r.targetRevision)}</p></header>
<h2>Executive summary</h2><div class="metrics"><div class="metric"><strong>${esc(r.summary.totalControls)}</strong>Controls in scope</div><div class="metric"><strong>${esc(r.summary.controlsWithStaticArtifacts)}</strong>Controls with candidate static collections</div><div class="metric"><strong>${esc(r.summary.decisionStageControls)}</strong>Decision-stage controls</div><div class="metric"><strong>${esc(r.summary.sourceArtifactsIntegrityChecked)}</strong>Stored artifacts checked</div></div>
<p class="warn"><b>Interpretation:</b> Stored SHA-256 integrity and source identity have been checked; security effectiveness, applicability, evidence sufficiency and final decisions remain unverified by this document. No PASS/FAIL determination is presented.</p>
<h2>Assessment boundary</h2><p>Control coverage is an inventory, not confirmed compliance. This HTML file is generated from the canonical read-only assessment draft and contains no source code or secret values.</p>
<h2>Limitations and release conditions</h2><ul>${r.limitations.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p><b>Required before client release:</b> evidence adequacy review, explicit human decisions, separately authorised active tests where relevant, and accountable report sign-off.</p>
<h2>Control-by-control review register</h2>${rows}
<footer><hr><p>AgentRiskLayer • Draft. No OWASP certification, UKAS accreditation or deployment-readiness claim.</p></footer></main></body></html>`;
}
export function writeAssessmentClientHtml({report,outputDirectory}) {
  const html=renderAssessmentClientHtml(report);
  const root=path.resolve(outputDirectory);
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const name='assessment-evidence-draft-'+report.targetRevision.slice(0,12)+'.html';
  const file=path.join(root,name);
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
  let status='created';
  try {const fd=fs.openSync(file,flags,0o600);try{fs.writeFileSync(fd,html,'utf8');}finally{fs.closeSync(fd);}}
  catch(e){if(e.code!=='EEXIST')throw e;const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||fs.readFileSync(file,'utf8')!==html)throw new Error('Existing assessment export differs; refusing overwrite.',{cause:e});status='already_present_identical';}
  return {file,status,bytes:Buffer.byteLength(html),sha256:crypto.createHash('sha256').update(html).digest('hex')};
}
