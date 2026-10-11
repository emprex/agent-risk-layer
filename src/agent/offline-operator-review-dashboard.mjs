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

const CONTROL_LANES = [
  'follow_up_blocked', 'human_applicability', 'test_planning',
  'evidence_collection', 'human_decision', 'review_required'
];
const REVIEW_LANES = new Set(['test_planning', 'evidence_collection']);

// The canonical control journey provides closed status vocabularies. Routing
// metadata can be tainted by stale or malformed sources; a mere length limit
// could expose a short credential in the exported, private HTML file.
const REGISTRY_STATUS = Object.freeze({
  currentStage:new Set([
    'applicability','test','evidence','finding','remediation','retest',
    'approval','deployment_decision'
  ]),
  chainStatus:new Set([
    'applicable_unassessed','reassessment_required','context_required',
    'not_applicable','runtime_regression','remediation_in_progress',
    'finding_open','controlled_with_evidence','test_inconclusive',
    'test_failed','test_planned'
  ]),
  deploymentImpact:new Set(['hold','satisfied','blocker','not_applicable'])
});

function registryStatus(field, value) {
  return typeof value === 'string' && REGISTRY_STATUS[field]?.has(value)
    ? value : null;
}

// The full register is strictly the authoritative snapshot work queue.
// A control outside the independent evidence lanes is not omitted, and its
// queue status is NOT an approval, PASS, or completed security assessment.
function snapshotControlRegistry(queue, index) {
  if (queue?.complete !== true ||
      queue.systemSnapshotId !== index.systemSnapshotId ||
      queue.total !== index.queueTotal ||
      !Array.isArray(queue.controlIds) ||
      !queue.lanes || typeof queue.lanes !== 'object')
    throw new Error('Complete same-snapshot authoritative 108-control register required.');
  readOnly(queue);
  const selectedIds = new Set(index.batches.flatMap(batch => batch.controlIds));
  const registry = [];
  for (const lane of CONTROL_LANES) {
    if (!Array.isArray(queue.lanes[lane]))
      throw new Error('Authoritative control register has a missing lane.');
    for (const item of queue.lanes[lane]) {
      if (!ID.test(item?.controlId || '') ||
          (REVIEW_LANES.has(lane) !== selectedIds.has(item.controlId))) {
        throw new Error('Authoritative control register contradicts the evidence work queue.');
      }
      // Only recognised canonical state codes. Unknown/malicious values
      // cannot be promoted into report text, irrespective of string length.
      registry.push({
        controlId:item.controlId,
        lane,
        currentStage:registryStatus('currentStage',item.currentStage),
        chainStatus:registryStatus('chainStatus',item.chainStatus),
        deploymentImpact:registryStatus('deploymentImpact',item.deploymentImpact),
        inEvidenceWorkplan:REVIEW_LANES.has(lane)
      });
    }
  }
  const ids=registry.map(item => item.controlId);
  if (ids.length !== queue.total ||
      new Set(ids).size !== ids.length ||
      ids.slice().sort().join('|') !== queue.controlIds.slice().sort().join('|') ||
      registry.filter(x => x.inEvidenceWorkplan).length !== index.eligibleControls ||
      registry.filter(x => !x.inEvidenceWorkplan).length !== index.excludedControls)
    throw new Error('Authoritative full control register is incomplete or inconsistent.');
  return registry.sort((a,b)=>a.controlId.localeCompare(b.controlId));
}

export function buildOfflineOperatorReviewDashboard(index, dossierBatches, expectedRevision, queue) {
  readOnly(index);
  if (!SHA.test(expectedRevision || ''))
    throw new Error('Exact frozen target Git revision required for offline export.');
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
    const {preparationDigestSha256, ...dossierPayload} = dossier || {};
    if (!/^[a-f0-9]{64}$/.test(preparationDigestSha256 || '') ||
        hash(JSON.stringify(dossierPayload)) !== preparationDigestSha256)
      throw new Error('Offline review dossier content digest mismatch.');
    if (!Array.isArray(dossier?.dossiers) ||
        dossier.systemSnapshotId !== index.systemSnapshotId ||
        dossier.controlCount !== batch.controlIds.length ||
        dossier.controlIds?.length !== batch.controlIds.length ||
        dossier.testsExecuted !== 0 || dossier.evidencePersisted !== 0 ||
        dossier.evidenceAutomaticallyVerified !== 0 ||
        !SHA.test(dossier.targetRevision || ''))
      throw new Error('Offline review batch is incomplete or changed.');
    if (!revision) revision = dossier.targetRevision;
    if (revision !== dossier.targetRevision || revision !== expectedRevision)
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
  const registry=snapshotControlRegistry(queue,index);
  return {
    schema:'arl.agent.offline-operator-review-dashboard.v1',
    controlRegistry:registry,
    registryTotal:registry.length,
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
  '.workstreams{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:14px 0 20px}',
  '.workstream{background:#fff;border:1px solid #dce4ee;border-radius:12px;padding:14px;min-width:0}',
  '.workstream h3{margin:0 0 6px}.workstream p{margin:8px 0}.workstream details{margin:10px 0 0}',
  '.workstream summary,.all-controls summary{cursor:pointer;color:#18569d;font-weight:600}',
  '.workstream .links,.all-controls .links{margin:10px 0 0}.all-controls{padding:12px;background:#fff;border:1px solid #dce4ee;border-radius:12px;margin:12px 0 20px}',
  '.workstream a{overflow-wrap:anywhere}.counts{color:#50607a;font-weight:500;font-size:.9rem}',
  '.registry table{width:100%}.registry .held{font-weight:600}.registry td code{white-space:nowrap}',
  '@media print{body{background:white}details{break-inside:avoid}}'
].join('');

// Presentation-only work order derived from already prepared, snapshot-bound
// evidence metadata. A control may appear in more than one stream; these are
// collection/review tasks, never independent PASS/FAIL or authorization claims.
const WORKSTREAMS = Object.freeze([
  {
    id: 'frozen-source',
    label: '1. Missing frozen-source observations',
    key: 'missingStaticMetadata',
    instruction: 'Collect or inspect missing version-bound static observations. Existing source metadata is a candidate, never accepted proof.'
  },
  {
    id: 'human-records',
    label: '2. Human evidence and ownership',
    key: 'requiresHumanDocuments',
    instruction: 'Obtain attributable approvals, scope decisions and owner records. Only an accountable reviewer can accept them.'
  },
  {
    id: 'runtime-authorisation',
    label: '3. Separately authorised runtime checks',
    key: 'requiresSeparateRuntimeAuthorisation',
    instruction: 'Plan bounded positive and negative tests with explicit owner authorisation; this offline document does not run tests.'
  },
  {
    id: 'source-lineage',
    label: '4. Source provenance exceptions',
    key: 'sourceLineageExceptions',
    instruction: 'Resolve ambiguous, stale or invalid source lineage before considering evidence usable for a criterion.'
  }
]);

export function buildOperatorReviewWorkplan(dashboard) {
  readOnly(dashboard);
  if (!Array.isArray(dashboard?.controls) ||
      dashboard.assessedControls !== dashboard.controls.length ||
      !SHA.test(dashboard.targetRevision || '')) {
    throw new Error('A complete frozen operator dashboard is required for the work plan.');
  }
  return WORKSTREAMS.map(stream => {
    const controls = dashboard.controls.filter(control => {
      if (!ID.test(control?.controlId || '') ||
          control.outcome !== 'operator_review_required') {
        throw new Error('The operator work plan rejects a foreign control or inferred result.');
      }
      const count = control.summary?.[stream.key] ?? 0;
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('The operator work plan requires bounded evidence requirement counts.');
      }
      return count > 0;
    });
    return {
      id: stream.id,
      label: stream.label,
      instruction: stream.instruction,
      countKey: stream.key,
      controlCount: controls.length,
      requirementCount: controls.reduce((total, control) =>
        total + (control.summary?.[stream.key] || 0), 0),
      controls: controls.map(control => ({
        id: control.controlId,
        title: control.title || control.controlId,
        requirementCount: control.summary[stream.key]
      }))
    };
  });
}

function workstreamMarkup(stream) {
  return '<section class="workstream"><h3>'+esc(stream.label)+'</h3>'+
    '<p class="counts">'+esc(stream.controlCount)+' controls · '+
    esc(stream.requirementCount)+' requirements or exceptions</p>'+
    '<p>'+esc(stream.instruction)+'</p>'+
    (stream.controlCount
      ? '<details><summary>Show '+esc(stream.controlCount)+
        ' affected controls</summary><nav class="links" aria-label="'+
        esc(stream.label)+'">'+stream.controls.map(control =>
          '<a href="#'+esc(control.id)+'">'+esc(control.id)+
          ' ('+esc(control.requirementCount)+')</a>'
        ).join('')+'</nav></details>'
      : '<p class="muted">None in this prepared snapshot.</p>')+
    '</section>';
}

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

const LANE_ACTION = Object.freeze({
  follow_up_blocked:'Separate blocked finding / remediation follow-up — not resolved here',
  human_applicability:'Accountable human applicability decision required',
  test_planning:'Independent test planning and evidence review only',
  evidence_collection:'Independent evidence collection and human validation',
  human_decision:'Human decision-stage record — not evidence of approval',
  review_required:'Further accountable review required'
});

function statusRows(records) {
  return records.map(record => '<tr><td>'+
    (record.inEvidenceWorkplan
      ? '<a href="#'+esc(record.controlId)+'">'+esc(record.controlId)+'</a>'
      : '<code>'+esc(record.controlId)+'</code>')+
    '</td><td>'+safeLabel(record.lane)+'</td>'+
    '<td>'+safeLabel(registryStatus('currentStage',record.currentStage))+'</td>'+
    '<td>'+safeLabel(registryStatus('chainStatus',record.chainStatus))+'</td>'+
    '<td>'+safeLabel(registryStatus('deploymentImpact',record.deploymentImpact))+'</td>'+
    '<td>'+esc(LANE_ACTION[record.lane])+'</td></tr>').join('');
}

function statusTable(records) {
  return '<div class="table-wrap"><table><thead><tr>'+
    '<th>Control</th><th>Lane</th><th>Current stage</th>'+
    '<th>Chain status</th><th>Impact</th><th>Operator routing</th>'+
    '</tr></thead><tbody>'+statusRows(records)+'</tbody></table></div>';
}

function fullControlRegistryMarkup(dashboard) {
  const records=dashboard.controlRegistry;
  const excluded=records.filter(record=>!record.inEvidenceWorkplan);
  return '<section class="registry"><h2>All '+esc(records.length)+
    ' controls — authoritative snapshot</h2>'+
    '<p class="muted">All controls are accounted for. The independent work plan below covers '+
    esc(dashboard.assessedControls)+' evidence/test-preparation controls. '+
    'The '+esc(excluded.length)+' controls in other lanes are not approved or closed by this page.</p>'+
    '<h3>Controls requiring separate follow-up — '+esc(excluded.length)+'</h3>'+
    '<p class="muted">Visible without expanding a menu: blocked findings and '+
    'human-decision-stage controls remain distinct from the evidence work plan. '+
    'Human decision stage does not prove human approval. Deployment HOLD remains.</p>'+
    statusTable(excluded)+
    '<details><summary>Show complete '+esc(records.length)+
    '-control status table</summary>'+
    statusTable(records)+
    '</details></section>';
}

// Point-in-time navigation only. This panel never executes, accepts or approves actions.
// The excluded blocked lane is an authoritative queue routing state, not an
// evidence dossier. Give operators a useful follow-up entry without fabricating
// evidence, findings, owners, dates, closure or an active test.
export function operatorBlockedFollowupMarkup(dashboard) {
  readOnly(dashboard);
  if (!Array.isArray(dashboard?.controlRegistry) ||
      dashboard.registryTotal !== dashboard.controlRegistry.length ||
      !SHA.test(dashboard.targetRevision || '') ||
      !dashboard.systemSnapshotId ||
      dashboard.controlRegistry.some(row => !ID.test(row?.controlId || '') ||
        !CONTROL_LANES.includes(row.lane))) {
    throw new Error('Validated same-snapshot control register required for blocked follow-up.');
  }
  const blocked = dashboard.controlRegistry.filter(row => row.lane === 'follow_up_blocked');
  if (!blocked.length) return '';
  return '<section class="registry" aria-label="Blocked control review">'+
    '<h2>Blocked findings — accountable follow-up</h2>'+
    '<p class="muted">These entries are excluded from independent evidence preparation. This offline page has no finding history, closure authority or test permission. Open the authoritative assessment to inspect the original finding and its owner before taking action.</p>'+
    blocked.map(row => '<details><summary>'+esc(row.controlId)+
      ' · blocked follow-up</summary><div class="body">'+
      '<p>Current stage: '+safeLabel(registryStatus('currentStage',row.currentStage))+
      ' · Chain status: '+safeLabel(registryStatus('chainStatus',row.chainStatus))+
      ' · Deployment impact: '+safeLabel(registryStatus('deploymentImpact',row.deploymentImpact))+'</p>'+
      '<p><strong>Human review required:</strong> inspect the exact finding and evidence provenance; identify the accountable owner; document remediation and a separately authorised exact-version retest before considering closure.</p>'+
      '<p class="pending">Not resolved. No automatic severity, attribution, retest, closure or deployment decision.</p>'+
      '</div></details>').join('')+
    '<p class="muted">Prepared snapshot <code>'+esc(dashboard.systemSnapshotId)+
    '</code> · Frozen SHA <code>'+esc(dashboard.targetRevision)+'</code></p></section>';
}

export function operatorNextActionMarkup(dashboard) {
  readOnly(dashboard);
  if (!Array.isArray(dashboard?.controlRegistry) ||
      dashboard.registryTotal !== dashboard.controlRegistry.length ||
      !SHA.test(dashboard?.targetRevision || '') ||
      !dashboard.systemSnapshotId) {
    throw new Error('Validated frozen Operator register required for next-action guidance.');
  }
  const counts = Object.fromEntries(CONTROL_LANES.map(lane => [
    lane, dashboard.controlRegistry.filter(row => row.lane === lane).length
  ]));
  const blocked = counts.follow_up_blocked;
  const human = counts.human_decision;
  const evidence = counts.test_planning + counts.evidence_collection +
    counts.human_applicability + counts.review_required;
  const guidance = blocked > 0
    ? 'First review the blocked finding or remediation in the separate accountable ARL workflow. Do not infer closure.'
    : human > 0
      ? 'First review pending accountable human decisions in the authoritative ARL workflow. This page cannot approve them.'
      : evidence > 0
        ? 'Start with the evidence work plan below, verifying provenance and required human records before any test.'
        : 'No pending queue item is demonstrated by this snapshot. Verify the live assessment before deciding anything.';
  return '<section class="notice" aria-label="Operator next action"><h2>Next operator action — review only</h2>'+
    '<p><strong>'+esc(guidance)+'</strong></p>'+
    '<p>Blocked follow-up: '+esc(blocked)+' controls · Human-decision stage: '+
    esc(human)+' controls · Other review stages: '+esc(evidence)+' controls.</p>'+
    '<p class="muted">Prepared snapshot '+esc(dashboard.systemSnapshotId)+
    ', frozen target '+esc(dashboard.targetRevision)+
    '. Reopen the current authoritative assessment before recording any action. No tests or decisions can be performed here.</p></section>';
}

// Private snapshot-bound metadata only; narrative/paths are deliberately excluded.
export function operatorScopeOverviewMarkup(dashboard) {
  readOnly(dashboard);
  const scope = dashboard?.scopeOverview;
  if (!scope) return '<section class="notice"><h2>Assessment scope</h2><p>Scope metadata not included in this prepared view. Inspect the authoritative context separately.</p></section>';
  if (scope.systemSnapshotId !== dashboard.systemSnapshotId ||
      scope.targetRevision !== dashboard.targetRevision ||
      !['test','development','staging','production','unknown'].includes(scope.environment) ||
      typeof scope.architectureSummaryRecorded !== 'boolean' ||
      typeof scope.capabilityProfileRecorded !== 'boolean' ||
      !Number.isSafeInteger(scope.confirmedArchitectureFactCount) ||
      scope.confirmedArchitectureFactCount < 0 ||
      !Number.isSafeInteger(scope.manualArchitectureFactCount) ||
      scope.manualArchitectureFactCount < 0) {
    throw new Error('Operator scope overview does not match the frozen authoritative snapshot.');
  }
  return '<section class="registry"><h2>Assessment scope — read-only</h2>'+
    '<p>Environment: <strong>'+esc(scope.environment)+'</strong> · Architecture description recorded: '+
    (scope.architectureSummaryRecorded ? 'yes' : 'no')+
    ' · Capability profile recorded: '+(scope.capabilityProfileRecorded ? 'yes' : 'no')+'</p>'+
    '<p>Architecture facts recorded: '+esc(scope.confirmedArchitectureFactCount)+
    ' · Manually declared facts: '+esc(scope.manualArchitectureFactCount)+'</p>'+
    '<p class="muted">Same snapshot and exact Git revision shown above. Descriptions, local paths and credentials are not copied into this HTML. These recorded fields are not proof of scope authorisation, evidence acceptance or deployment approval.</p></section>';
}

export function renderOfflineOperatorReviewHtml(dashboard) {
  readOnly(dashboard);
  if (!SHA.test(dashboard?.targetRevision || '') ||
      !Array.isArray(dashboard.controls) ||
      dashboard.assessedControls !== dashboard.controls.length ||
      dashboard.controls.some(c => c.outcome !== 'operator_review_required') ||
      !Array.isArray(dashboard.controlRegistry) ||
      dashboard.registryTotal !== dashboard.controlRegistry.length ||
      dashboard.registryTotal !== dashboard.assessedControls + dashboard.excludedControls ||
      new Set(dashboard.controlRegistry.map(x=>x.controlId)).size !== dashboard.registryTotal ||
      dashboard.controlRegistry.some(x => !ID.test(x?.controlId || '') ||
        !CONTROL_LANES.includes(x.lane) ||
        x.inEvidenceWorkplan !== REVIEW_LANES.has(x.lane)) ||
      dashboard.controls.some(x => !dashboard.controlRegistry.some(row =>
        row.controlId === x.controlId && row.inEvidenceWorkplan === true)))
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
    (dashboard.syntheticDemo === true ? '<div class="notice" role="status"><strong>SYNTHETIC DEMONSTRATION — NO REAL ASSESSMENT OR CUSTOMER DATA.</strong> All controls, tests, evidence IDs and results shown below are invented exclusively for a UI preview.</div>' : '')+
    '<div class="notice"><strong>Deployment HOLD / no release authority inferred.</strong> '+
    'Blocked findings and final human decisions are excluded from these independent work items, not resolved.</div>'+
    operatorScopeOverviewMarkup(dashboard)+
    operatorNextActionMarkup(dashboard)+
    operatorBlockedFollowupMarkup(dashboard)+
    '<section class="metrics">'+[
      ['Independent controls',dashboard.assessedControls],
      ['Excluded controls',dashboard.excludedControls],
      ['Missing static observations',sum('missingStaticMetadata')],
      ['Human evidence requirements',sum('requiresHumanDocuments')],
      ['Separate runtime authorisations',sum('requiresSeparateRuntimeAuthorisation')]
    ].map(([title,num])=>'<div><b>'+esc(num)+'</b><small>'+esc(title)+'</small></div>').join('')+'</section>'+
    fullControlRegistryMarkup(dashboard)+
    '<h2>Evidence work plan</h2><p class="muted">Priority is an operator navigation aid, not a security finding or a request to execute tests. Streams overlap: one control can require source evidence, human records and authorised runtime observations. Counts are not distinct findings or approved actions.</p>'+
    '<div class="workstreams">'+buildOperatorReviewWorkplan(dashboard).map(workstreamMarkup).join('')+'</div>'+
    '<h2>All '+esc(dashboard.assessedControls)+' independent controls</h2><p class="muted">Open a control for exact-version criteria, existing evidence and recorded test metadata. No external resources or scripts are loaded.</p>'+
    '<details class="all-controls"><summary>Show all '+esc(dashboard.assessedControls)+' control links</summary><nav class="links" aria-label="All independent controls">'+dashboard.controls.map(c=>'<a href="#'+esc(c.controlId)+'">'+esc(c.controlId)+'</a>').join('')+'</nav></details>'+
    '<main class="controls">'+dashboard.controls.map(controlMarkup).join('')+'</main>'+
    '<footer>Offline preparation artifact. Recheck the authoritative assessment before recording any decision.</footer></body></html>';
}

function assertPrivateDirectory(root) {
  let current = root;
  for (;;) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error('Offline operator output directory cannot use symlinked ancestors.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const directory = fs.statSync(root);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0)
    throw new Error('Offline operator output directory must be a private real directory (0700).');
}

function unchangedArtifact(target, html) {
  if (fs.lstatSync(target).isSymbolicLink() ||
      !fs.lstatSync(target).isFile() ||
      (fs.statSync(target).mode & 0o077) !== 0 ||
      fs.readFileSync(target, 'utf8') !== html)
    throw new Error('Conflicting or non-private immutable operator artifact.');
  return {path:target,status:'unchanged',sha256:hash(html),bytes:Buffer.byteLength(html),
    artifactStateChanged:false,securityStateChanged:false,deploymentDecisionWritten:false};
}

export function writeOfflineOperatorReviewDashboard({dashboard,outputDirectory}={}) {
  const html=renderOfflineOperatorReviewHtml(dashboard);
  if (!outputDirectory) throw new Error('Explicit operator artifact output directory required.');
  const root=path.resolve(outputDirectory);
  if (root===path.parse(root).root) throw new Error('Refusing filesystem root as operator artifact directory.');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  assertPrivateDirectory(root);
  const name='ARL-operator-review-'+hash(html).slice(0,16)+'.html';
  const target=path.join(root,name);
  if (fs.existsSync(target)) {
    return unchangedArtifact(target, html);
  }
  const temporary=path.join(root,'.'+name+'.'+crypto.randomBytes(12).toString('hex')+'.tmp');
  // Write and sync privately before linking the complete object into place.
  // A hard-link is atomic and fails closed if the destination already exists.
  let fd;
  try {
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,html,{encoding:'utf8'});
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd=undefined;
    try {
      fs.linkSync(temporary,target);
    } catch(error) {
      if(error?.code === 'EEXIST') return unchangedArtifact(target, html);
      throw error;
    }
  } finally {
    if(fd!==undefined) fs.closeSync(fd);
    fs.rmSync(temporary,{force:true});
  }
  return {path:target,status:'created',sha256:hash(html),bytes:Buffer.byteLength(html),
    artifactStateChanged:true,securityStateChanged:false,deploymentDecisionWritten:false};
}
