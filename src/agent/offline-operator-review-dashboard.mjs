import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHA = /^[0-9a-f]{40}$/;
const ID = /^ARL-KB-[0-9]{3}$/;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);
const safeLabel = value => esc(String(value || 'unknown').replace(/_/g,' '));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function readOnly(value) {
  if (value?.securityStateChanged !== false ||
      value?.deploymentDecisionWritten !== false ||
      value?.humanReviewRequired !== true)
    throw new Error('Offline operator review cannot accept security authority changes.');
}

export function buildOfflineOperatorReviewDashboard(index, dossierBatches) {
  readOnly(index);
  if (!index?.systemSnapshotId || !Array.isArray(index.batches) ||
      index.batchCount !== index.batches.length ||
      !Array.isArray(dossierBatches) ||
      dossierBatches.length !== index.batchCount)
    throw new Error('Complete authoritative operator review batches required.');
  const controls = [];
  let revision = null;
  for (const [i,batch] of index.batches.entries()) {
    const dossier = dossierBatches[i];
    readOnly(dossier);
    if (!Array.isArray(dossier?.dossiers) ||
        dossier.systemSnapshotId !== index.systemSnapshotId ||
        dossier.controlCount !== batch.controlIds.length ||
        dossier.controlIds?.length !== batch.controlIds.length ||
        dossier.testsExecuted !== 0 || dossier.evidencePersisted !== 0 ||
        dossier.evidenceAutomaticallyVerified !== 0 ||
        !SHA.test(dossier.targetRevision || ''))
      throw new Error('Offline review batch is incomplete or changed.');
    if (!revision) revision = dossier.targetRevision;
    if (revision !== dossier.targetRevision)
      throw new Error('Offline review target revision changed between batches.');
    for (const [j,control] of dossier.dossiers.entries()) {
      const id = batch.controlIds[j];
      if (!ID.test(id || '') || control?.controlId !== id ||
          dossier.controlIds[j] !== id ||
          control.outcome !== 'operator_review_required' ||
          control.evidenceAutomaticallyAccepted !== false ||
          control.findingAutomaticallyClosed !== false ||
          control.deploymentDecisionWritten !== false ||
          !Array.isArray(control.criteria) ||
          !Array.isArray(control.evidenceInventory) ||
          !Array.isArray(control.testInventory) ||
          control.criteria.some((c,k) => c.requirementIndex !== k+1 ||
            c.criterionSatisfied !== false ||
            c.humanDecisionRequired !== true ||
            !String(c.requirement || '').trim()) ||
          control.evidenceInventory.some(e => e.controlId !== id || e.isCandidateOnly !== true) ||
          control.testInventory.some(t => t.controlId !== id))
        throw new Error('Offline review rejects inferred verdict, foreign record or criterion mismatch.');
      controls.push(control);
    }
  }
  if (controls.length !== index.eligibleControls ||
      new Set(controls.map(c=>c.controlId)).size !== controls.length ||
      index.excludedControls !== index.queueTotal-index.eligibleControls)
    throw new Error('Offline review does not cover all independent control identities.');
  return {
    schema:'arl.agent.offline-operator-review-dashboard.v1',
    systemSnapshotId:index.systemSnapshotId,
    targetRevision:revision,
    assessedControls:controls.length,
    excludedControls:index.excludedControls,
    controls,
    testsExecuted:0,
    evidencePersisted:0,
    evidenceAutomaticallyVerified:0,
    securityStateChanged:false,
    deploymentDecisionWritten:false,
    humanReviewRequired:true
  };
}

const css = [
  'body{font-family:system-ui,sans-serif;background:#f3f6fa;color:#182637;max-width:1150px;margin:auto;padding:20px}',
  '*{box-sizing:border-box}header{background:#172a45;color:#fff;border-radius:16px;padding:23px}',
  'h1{margin:6px 0}h2{font-size:1.2rem}h3{font-size:1rem;margin-bottom:4px}p{line-height:1.5}',
  'header p{color:#dfebf8}code{overflow-wrap:anywhere;font-size:.88em}',
  '.notice{background:#fff4dc;border-left:4px solid #ae7118;padding:12px 16px;margin:15px 0}',
  '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.metrics div{background:white;border:1px solid #dce4ee;padding:12px;border-radius:12px;min-width:148px}',
  '.metrics b{display:block;font-size:1.5rem}.metrics small,.muted{color:#5d6b7e}',
  '.controls details{background:#fff;border:1px solid #dce4ee;border-radius:12px;margin:9px 0;overflow:hidden}',
  'summary{cursor:pointer;padding:13px;font-weight:600}summary:hover{background:#eff3f9}',
  '.body{padding:15px;border-top:1px solid #dce4ee}.body details{margin:12px 0}',
  '.tag{background:#edf1f7;border-radius:8px;padding:3px 7px;font-size:.79rem;margin:0 5px}',
  '.criteria li{padding:11px 0;border-bottom:1px solid #e6ebf3}.pending{color:#785112;font-weight:600}',
  '.links{display:flex;flex-wrap:wrap;gap:12px}.links a{color:#18569d}',
  'table{border-collapse:collapse;width:100%;font-size:.88rem}td,th{padding:8px;border-bottom:1px solid #e1e7ef;text-align:left}',
  '.table-wrap{overflow:auto}footer{margin-top:26px;color:#66748a}',
  '@media print{body{background:white}details{break-inside:avoid}}'
].join('');

function rowsEvidence(e) {
  return '<tr><td><code>'+esc(e.id)+'</code></td><td>'+safeLabel(e.verificationState)+
    '</td><td>'+safeLabel(e.retentionStatus)+'</td><td>'+
    (e.snapshotCurrent?'Current':'Historical')+'</td><td>'+safeLabel(e.sourceType)+'</td></tr>';
}

function criteriaMarkup(c) {
  return '<li><strong>'+esc(c.requirementIndex)+'. '+esc(c.requirement)+'</strong> '+
    '<span class="tag">'+safeLabel(c.mode)+'</span>'+
    '<p class="muted">'+safeLabel(c.reviewState)+'</p><p>'+esc(c.operatorAction)+'</p>'+
    (c.existingEvidenceCandidates?.length ?
      '<p class="muted">Candidates, not accepted: '+esc(c.existingEvidenceCandidates.join(', '))+'</p>':'')+
    '<p class="pending">Criterion undetermined — human review required.</p></li>';
}

function controlMarkup(d) {
  const s=d.summary || {};
  return '<details id="'+esc(d.controlId)+'"><summary>'+esc(d.controlId)+' · '+
    esc(d.title)+' <span class="tag">'+safeLabel(d.chainStatus)+'</span></summary>'+
    '<div class="body"><p class="muted">Static candidates: '+esc(s.sourceMetadataCandidates??0)+
    ' · Missing static: '+esc(s.missingStaticMetadata??0)+
    ' · Human documents: '+esc(s.requiresHumanDocuments??0)+
    ' · Runtime approval required: '+esc(s.requiresSeparateRuntimeAuthorisation??0)+
    ' · Lineage exceptions: '+esc(s.sourceLineageExceptions??0)+'</p>'+
    '<h3>Objective</h3><p>'+esc(d.testDefinition?.objective)+'</p>'+
    '<h3>Test method</h3><p>'+esc(d.testDefinition?.method)+'</p>'+
    '<h3>Required evidence and next steps</h3><ol class="criteria">'+
    d.criteria.map(criteriaMarkup).join('')+'</ol>'+
    '<details><summary>Recorded evidence ('+d.evidenceInventory.length+
    ')</summary><div class="table-wrap"><table><thead><tr><th>Evidence ID</th><th>Verification state</th><th>Retention</th><th>Snapshot</th><th>Type</th></tr></thead><tbody>'+
    d.evidenceInventory.map(rowsEvidence).join('')+'</tbody></table></div></details>'+
    '<details><summary>Recorded tests ('+d.testInventory.length+')</summary><ul>'+
    d.testInventory.map(t=>'<li><code>'+esc(t.id)+'</code> · '+safeLabel(t.result)+
      ' · '+safeLabel(t.executionMethod)+' · digest '+(t.checkDigestMatches?'matches':'mismatch')+'</li>').join('')+
    '</ul></details>'+
    '<details><summary>Canonical pass and fail conditions</summary><p><strong>Pass:</strong> '+
    esc(d.testDefinition?.passCondition)+'</p><p><strong>Fail:</strong> '+
    esc(d.testDefinition?.failCondition)+'</p></details>'+
    '<p class="pending">No PASS/FAIL inferred. Decisions must be recorded in ARL by the accountable human.</p></div></details>';
}

export function renderOfflineOperatorReviewHtml(dashboard) {
  readOnly(dashboard);
  if (!SHA.test(dashboard?.targetRevision || '') ||
      !Array.isArray(dashboard.controls) ||
      dashboard.assessedControls !== dashboard.controls.length ||
      dashboard.controls.some(c => c.outcome !== 'operator_review_required'))
    throw new Error('Validated operator dashboard required.');
  const sum=(key)=>dashboard.controls.reduce((n,c)=>n+(c.summary?.[key]||0),0);
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+
    '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">'+
    '<title>ARL operator review — offline</title><style>'+css+'</style></head><body>'+
    '<header><small>AGENTRISKLAYER · Offline operator view</small><h1>Evidence review dashboard</h1>'+
    '<p>Read-only preparation only. This page is not certification, a PASS/FAIL finding or deployment approval.</p>'+
    '<p>Snapshot: <code>'+esc(dashboard.systemSnapshotId)+'</code><br>Frozen Git revision: <code>'+
    esc(dashboard.targetRevision)+'</code></p></header>'+
    '<div class="notice"><strong>Deployment HOLD / no release authority inferred.</strong> '+
    'Blocked findings and final human decisions are excluded from these independent work items, not resolved.</div>'+
    '<section class="metrics">'+[
      ['Independent controls',dashboard.assessedControls],
      ['Excluded controls',dashboard.excludedControls],
      ['Missing static observations',sum('missingStaticMetadata')],
      ['Human evidence requirements',sum('requiresHumanDocuments')],
      ['Separate runtime authorisations',sum('requiresSeparateRuntimeAuthorisation')]
    ].map(([title,num])=>'<div><b>'+esc(num)+'</b><small>'+esc(title)+'</small></div>').join('')+'</section>'+
    '<h2>Controls for review</h2><p class="muted">Choose a control to view criteria, test and evidence metadata. No external resources or scripts are loaded.</p>'+
    '<nav class="links">'+dashboard.controls.map(c=>'<a href="#'+esc(c.controlId)+'">'+esc(c.controlId)+'</a>').join('')+'</nav>'+
    '<main class="controls">'+dashboard.controls.map(controlMarkup).join('')+'</main>'+
    '<footer>Offline preparation artifact. Recheck the authoritative assessment before recording any decision.</footer></body></html>';
}

export function writeOfflineOperatorReviewDashboard({dashboard,outputDirectory}={}) {
  const html=renderOfflineOperatorReviewHtml(dashboard);
  if (!outputDirectory) throw new Error('Explicit operator artifact output directory required.');
  const root=path.resolve(outputDirectory);
  if (root===path.parse(root).root) throw new Error('Refusing filesystem root as operator artifact directory.');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  if (!fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink())
    throw new Error('Output must be a real directory.');
  const name='ARL-operator-review-'+hash(html).slice(0,16)+'.html';
  const target=path.join(root,name);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isFile() ||
        fs.readFileSync(target,'utf8')!==html)
      throw new Error('Conflicting immutable operator artifact.');
    return {path:target,status:'unchanged',sha256:hash(html),bytes:Buffer.byteLength(html),
      artifactStateChanged:false,securityStateChanged:false,deploymentDecisionWritten:false};
  }
  fs.writeFileSync(target,html,{encoding:'utf8',mode:0o600,flag:'wx'});
  return {path:target,status:'created',sha256:hash(html),bytes:Buffer.byteLength(html),
    artifactStateChanged:true,securityStateChanged:false,deploymentDecisionWritten:false};
}
