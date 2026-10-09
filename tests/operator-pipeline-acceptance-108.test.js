import test from 'node:test';
import assert from 'node:assert/strict';

import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';
import {
  buildAssessmentEvidenceBatchIndex, summarizeAssessmentEvidenceBatches
} from '../src/agent/assessment-evidence-batch-index.mjs';
import { buildPilotBatchPlan } from '../src/agent/pilot-batch-plan.mjs';
import { buildPilotEvidenceLineageTriage } from '../src/agent/pilot-evidence-lineage-triage.mjs';
import { buildAssessmentEvidenceReviewPacks } from '../src/agent/assessment-evidence-review-packs.mjs';
import { buildAssessmentReviewDossiers } from '../src/agent/assessment-review-dossiers.mjs';
import { previewStaticCollection } from '../src/agent/assessment-static-collection-preview.mjs';

const revision = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const snapshotId = 'synthetic_snapshot';
const assessmentId = 'synthetic_assessment';
const id = n => 'ARL-KB-' + String(n).padStart(3, '0');
const completed = new Set([1, 2, 3, 4, 5, 46, 57, 90, 100]);

function authoritativeItem(n) {
  if (n === 6) return {
    controlId: id(n), currentStage: 'remediation',
    chainStatus: 'finding_open', deploymentImpact: 'blocker'
  };
  if (completed.has(n)) return {
    controlId: id(n), currentStage: 'deployment_decision',
    chainStatus: 'controlled_with_evidence', deploymentImpact: 'satisfied'
  };
  return {
    controlId: id(n), currentStage: 'test',
    chainStatus: 'test_inconclusive', deploymentImpact: 'hold'
  };
}

const rows = Array.from({length:108},(_,i) => authoritativeItem(i+1));
const pages = [rows.slice(0,50),rows.slice(50,100),rows.slice(100)].map((items,i,a) => ({
  systemSnapshot: {id:snapshotId},
  total: rows.length, items, hasMore: i < a.length-1
}));
const queue = buildControlWorkQueue(pages);
const index = buildAssessmentEvidenceBatchIndex(queue);
const frozen = {
  target: {repositoryPath:'/no-real-target',revision,dirty:false},
  binding: {verified:true,revisionBefore:revision,revisionAfter:revision},
  inspection: {subject:{environment:'local',projectName:'synthetic'}}
};

function detail(controlId, evidenceOverrides = {}) {
  const checkId = 'ARL-CHK-' + controlId.slice(-3);
  const checkDigest = 'digest-' + controlId;
  const machine = controlId + ' assessed system, exact version, environment and approved scope';
  const human = controlId + ' reviewer identity, role, timestamp and evidence digest';
  const runtime = controlId + ' positive and abuse inputs with expected and observed outputs';
  const reference = 'arl_frozen_source_evidence_collection_v2:' +
    revision + ':' + controlId + ':' + 'a'.repeat(64);
  const result = {
    id:'ctx-'+controlId,
    controlId, checkId, checkDigest,
    systemSnapshotId:snapshotId,
    executionMethod:'arl_frozen_source_evidence_collection_v2',
    executionKind:'initial',
    result:'inconclusive',
    inputReference:reference,
    observedResult:'Requirement-specific deterministic observations:\n' +
      JSON.stringify({
        schema:'arl.deterministic-evidence-collection.v1',
        targetRevision:revision,
        requirementObservations:[{
          requirement:machine,
          collectors:['target_identity'],
          observations:{target_identity:{revision,environment:'local'}}
        }]
      }) + '\nThis collection does not assert that any canonical requirement is satisfied and does not infer PASS/FAIL.'
  };
  const ev = {
    id:'cei-'+controlId,
    controlId,
    testExecutionId:result.id,
    systemSnapshotId:snapshotId,
    sourceType:'arl_frozen_source_evidence_collection_v2',
    sourceReference:reference,
    evidenceClass:'observed',
    retentionStatus:'active',
    verificationState:'unverified',
    ...evidenceOverrides
  };
  return {
    control:{id:controlId,title:'Fixture '+controlId},
    systemSnapshot:{
      id:snapshotId,
      versionIdentifier:revision,
      assessmentConfiguration:{
        targetBinding:{schema:'arl.target-binding.v1',source:'git',revision},
        assessmentBinding:{schema:'arl.assessment-binding.v1',assessmentId}
      }
    },
    testDefinition:{
      id:checkId,digest:checkDigest,
      objective:'Confirm bounded version-specific requirements.',
      method:'Inspect frozen source and human/runtime evidence separately.',
      requiredEvidence:[machine,human,runtime],
      passCondition:'All mandatory criteria supported by attributable version-bound evidence.',
      failCondition:'Mandatory evidence or required boundaries absent.',
      limitations:'Synthetic fixture cannot prove target behavior.'
    },
    tests:[result],testHistory:[result],
    evidence:[ev],evidenceHistory:[ev]
  };
}

function generateTriages() {
  const details = new Map(index.batches.flatMap(batch => batch.controlIds)
    .map(controlId => [controlId,detail(controlId)]));
  const triages = index.batches.map(batch => {
    const requested = batch.controlIds.map(cid => details.get(cid));
    const plan = buildPilotBatchPlan(queue,requested,batch.controlIds);
    return buildPilotEvidenceLineageTriage(plan,requested);
  });
  return {details,triages};
}

test('integrated 108-control operator chain builds five clean bounded batches without touching blocker', () => {
  assert.equal(queue.complete,true);
  assert.equal(queue.total,108);
  assert.deepEqual(queue.lanes.follow_up_blocked.map(item=>item.controlId),[id(6)]);
  assert.equal(index.eligibleControls,98);
  assert.equal(index.excludedControls,10);
  assert.deepEqual(index.batches.map(batch=>batch.controlIds.length),[20,20,20,20,18]);
  const {details,triages} = generateTriages();
  const summary = summarizeAssessmentEvidenceBatches(index,triages);
  assert.equal(summary.totals.staticCandidates,98);
  assert.equal(summary.totals.humanRequirements,98);
  assert.equal(summary.totals.runtimeRequirements,98);
  assert.equal(summary.totals.sourceLineageIssues,0);
  assert.equal(summary.evidencePromoted,0);
  assert.equal(summary.testsExecuted,0);
  const packs = buildAssessmentEvidenceReviewPacks(index,triages);
  assert.equal(packs.assessmentControls,98);
  assert.equal(packs.staticCollection.length,1);
  assert.equal(packs.humanDocumentation.length,1);
  assert.equal(packs.runtimeValidation.length,1);
  assert.equal(packs.staticCollection[0].controlCount,98);
  assert.equal(packs.boundaries.humanDecisionsRemainSeparate,true);
  const first = index.batches[0];
  const dossier = buildAssessmentReviewDossiers({
    queue,controlIds:first.controlIds,
    details:first.controlIds.map(cid=>details.get(cid))
  });
  assert.equal(dossier.controlCount,20);
  assert.equal(dossier.dossiers[0].summary.sourceMetadataCandidates,1);
  assert.equal(dossier.dossiers[0].summary.requiresSeparateRuntimeAuthorisation,1);
  assert.equal(dossier.dossiers[0].summary.currentUnverifiedEvidence,1);
  assert.equal(dossier.dossiers[0].outcome,'operator_review_required');
  assert.ok(dossier.dossiers.every(d => d.criteria.every(c=>c.criterionSatisfied === false)));
  assert.equal(dossier.evidenceAutomaticallyVerified,0);
  assert.equal(dossier.securityStateChanged,false);
});

test('one source collection is reused for all 98 control review tasks without automatic acceptance', async () => {
  const {triages} = generateTriages();
  const review = buildAssessmentEvidenceReviewPacks(index,triages);
  let freezes=0;
  const preview = await previewStaticCollection({
    repositoryPath:'/no-real-target',frozenInspection:frozen,review,
    expectedRevision:revision,
    freezeRepository: async () => {
      freezes++;
      return {repositoryPath:'/no-real-target',revision,dirty:false};
    }
  });
  assert.equal(freezes,2);
  assert.equal(preview.counts.criteria,98);
  assert.equal(preview.counts.requirements,98);
  assert.equal(preview.counts.metadataCandidates,98);
  assert.equal(preview.evidencePersisted,0);
  assert.equal(preview.evidenceAutomaticallyVerified,0);
  assert.equal(preview.testsExecuted,0);
  assert.equal(preview.passFailInferred,false);
  assert.equal(preview.deploymentDecisionWritten,false);
});

test('retired verified evidence never counts as an active current verified record',()=>{
  const controlId=id(7);
  const stale=detail(controlId,{retentionStatus:'retired',verificationState:'verified'});
  const result=buildAssessmentReviewDossiers({queue,details:[stale],controlIds:[controlId]});
  assert.equal(result.dossiers[0].summary.currentVerifiedEvidenceRecords,0);
  assert.equal(result.dossiers[0].summary.currentUnverifiedEvidence,0);
  assert.equal(result.dossiers[0].evidenceInventory[0].retentionStatus,'retired');
});

test('mixed assessment versions and blocked KB-006 cannot leak into active dossier coverage',()=>{
  const controlId=id(7);
  const wrong=detail(controlId);
  wrong.systemSnapshot.assessmentConfiguration.targetBinding.revision='f'.repeat(40);
  // A mismatch between the snapshot Git binding and its version identifier fails closed.
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[wrong],controlIds:[controlId]
  }),/target binding changed/);
  assert.throws(()=>buildAssessmentReviewDossiers({
    queue,details:[detail(id(6))],controlIds:[id(6)]
  }),/not independently actionable/);
});
