import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';
import {
  ASSESSMENT_EVIDENCE_BATCH_SIZE,
  buildAssessmentEvidenceBatchIndex,
  summarizeAssessmentEvidenceBatches
} from '../src/agent/assessment-evidence-batch-index.mjs';

const id = n => 'ARL-KB-' + String(n).padStart(3, '0');
const finalDecision = new Set([1,2,3,4,5,46,57,90,100]);
const rows = Array.from({length: 108}, (_, at) => {
  const n = at + 1;
  if (n === 6) return {
    controlId: id(n), currentStage: 'remediation',
    chainStatus: 'finding_open', deploymentImpact: 'blocker'
  };
  if (finalDecision.has(n)) return {
    controlId: id(n), currentStage: 'deployment_decision',
    chainStatus: 'controlled_with_evidence', deploymentImpact: 'satisfied'
  };
  return {
    controlId: id(n), currentStage: 'test',
    chainStatus: 'test_inconclusive', deploymentImpact: 'hold'
  };
});
const pages = [
  {systemSnapshot:{id:'snap'},total:108,items:rows.slice(0,50)},
  {systemSnapshot:{id:'snap'},total:108,items:rows.slice(50,100)},
  {systemSnapshot:{id:'snap'},total:108,items:rows.slice(100)}
];

function fakeTriage(index, batch, withIssue = false) {
  const c = batch.controlIds.length;
  return {
    systemSnapshotId: index.systemSnapshotId,
    controls: batch.controlIds.map((controlId, at) => ({
      controlId,
      passInferred: false,
      executionAuthorised: false,
      summary: {
        sourceLineageIssues: at === 0 && withIssue ? 1 : 0,
        staticMissing: 0
      }
    })),
    summary: {
      controls:c,
      staticCandidates:c,
      staticMissing:0,
      humanRequirements:c,
      runtimeRequirements:2*c,
      sourceLineageIssues:withIssue?1:0
    },
    securityStateChanged:false,
    deploymentDecisionWritten:false
  };
}

test('108 controls become five bounded evidence batches, leaving KB-006 and approvals alone', () => {
  const queue = buildControlWorkQueue(pages);
  const index = buildAssessmentEvidenceBatchIndex(queue);
  assert.equal(index.queueTotal,108);
  assert.equal(index.eligibleControls,98);
  assert.equal(index.excludedControls,10);
  assert.equal(index.batchSize,ASSESSMENT_EVIDENCE_BATCH_SIZE);
  assert.equal(index.batchCount,5);
  assert.deepEqual(index.batches.map(b => b.controlIds.length),[20,20,20,20,18]);
  assert.ok(index.batches.some(b => b.controlIds.includes('ARL-KB-007')));
  assert.ok(index.batches.every(b => !b.controlIds.includes('ARL-KB-006')));
  assert.ok(index.batches.every(b => !b.controlIds.includes('ARL-KB-001')));
  assert.equal(index.securityStateChanged,false);
});

test('rollup checks each exact frozen batch and sums requirement categories only', () => {
  const index=buildAssessmentEvidenceBatchIndex(buildControlWorkQueue(pages));
  const triages=index.batches.map((batch,n) => fakeTriage(index,batch,n === 0));
  const result=summarizeAssessmentEvidenceBatches(index,triages);
  assert.equal(result.eligibleControls,98);
  assert.equal(result.totals.staticCandidates,98);
  assert.equal(result.totals.runtimeRequirements,196);
  assert.equal(result.attentionTotal,1);
  assert.equal(result.attention[0].batch,1);
  assert.equal(result.evidencePromoted,0);
  assert.equal(result.testsExecuted,0);
  assert.equal(result.securityStateChanged,false);
  assert.equal(result.deploymentDecisionWritten,false);
});

test('fails closed for missing, stale, reordered or permission-confused batch results', () => {
  const index=buildAssessmentEvidenceBatchIndex(buildControlWorkQueue(pages));
  const triages=index.batches.map(b => fakeTriage(index,b));
  assert.throws(()=>summarizeAssessmentEvidenceBatches(index,triages.slice(0,-1)), /Exact complete/);
  assert.throws(()=>summarizeAssessmentEvidenceBatches(index,[
    {...triages[0],systemSnapshotId:'old'},...triages.slice(1)
  ]), /mismatch/);
  assert.throws(()=>summarizeAssessmentEvidenceBatches(index,[
    {...triages[0],controls:[...triages[0].controls].reverse()},...triages.slice(1)
  ]), /mismatch/);
  assert.throws(()=>summarizeAssessmentEvidenceBatches(index,[
    {...triages[0],controls:triages[0].controls.map((x,i)=>i?x:{...x,executionAuthorised:true})},
    ...triages.slice(1)
  ]), /mismatch/);
});

test('refuses incomplete work queues and duplicate eligible controls', () => {
  const queue=buildControlWorkQueue(pages);
  assert.throws(()=>buildAssessmentEvidenceBatchIndex({...queue,complete:false}),/Complete authoritative/);
  assert.throws(()=>buildAssessmentEvidenceBatchIndex({
    ...queue,
    lanes:{...queue.lanes,test_planning:[
      ...queue.lanes.test_planning,queue.lanes.test_planning[0]
    ]}
  }),/duplicate eligible identities/);
});
