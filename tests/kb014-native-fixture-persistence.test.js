import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildKb014FixtureEvidenceRecord, KB014_CASES } from '../src/agent/kb014-active-executor.mjs';

const REV = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const SHA = '765bf3fd5de0036a7f00f04dae59c42a517dd6d0b619f01424198c9fdf4083f8';
const binding = {
  targetRevision: REV, snapshotId: 'sys_synthetic_001', checkDigest: SHA,
  roeReference: 'roe:rtau_synthetic001:control:ARL-KB-014',
  testerId: 'usr_local_test_001',
  startedAt: '2026-11-03T16:40:00.000Z',
  probeCompletedAt: '2026-11-03T16:40:01.000Z'
};

function complete() {
  return {
    status: 'native_lifecycle_fixture_integration_only',
    automaticPass: false, humanReviewRequired: true,
    receivingServiceAuthorizationTested: false,
    approvedInventoryReconciled: false,
    observations: KB014_CASES.map(([name, state]) => ({
      caseId: 'KB014-' + name, expectedState: state, observedState: state,
      ownerAttributed: state === 'active_cached' || state === 'expired_cached',
      expiryPresent: state === 'active_cached' || state === 'expired_cached',
      expiredByTargetCheck: state === 'expired_cached' ? true
        : state === 'absent' ? null : false,
      credentialReference: 'synthetic:' + name.toLowerCase(),
      fixtureOnly: true, nativeTokenStoreObserved: true,
      receivingPolicyObserved: false, inventoryReconciled: false
    }))
  };
}

test('full four-case observation round-trips from the canonical ledger budget with digest and ROE', () => {
  const record = buildKb014FixtureEvidenceRecord({...binding, outcome:complete()});
  assert.ok(record.observedResult.length < 2000);
  assert.equal(record.observationSha256, createHash('sha256').update(record.observedResult).digest('hex'));
  assert.equal(record.sourceReference, 'kb014-native-fixture:sha256:' + record.observationSha256);
  const parsed = JSON.parse(record.observedResult);
  assert.equal(parsed.schema, 'arl.kb014.native-oauth-fixture-execution.v1');
  assert.equal(parsed.systemSnapshotId, binding.snapshotId);
  assert.equal(parsed.targetRevision, binding.targetRevision);
  assert.equal(parsed.checkDigest, binding.checkDigest);
  assert.equal(parsed.roeReference, binding.roeReference);
  assert.equal(parsed.testerId, binding.testerId);
  assert.equal(parsed.startedAt, binding.startedAt);
  assert.equal(parsed.probeCompletedAt, binding.probeCompletedAt);
  assert.equal(parsed.status, 'native_lifecycle_fixture_integration_only');
  assert.equal(parsed.cases.length, 4);
  assert.deepEqual(parsed.cases.map(x => x.caseId), KB014_CASES.map(([n]) => 'KB014-' + n));
  assert.equal(parsed.receivingPolicyObserved, false);
  assert.equal(parsed.inventoryReconciled, false);
  assert.equal(parsed.automaticPass, false);
  assert.match(record.limitations, /no receiving-service authorization/i);
});

test('a complete native fixture mismatch is still only inconclusive review evidence', () => {
  const outcome = complete();
  outcome.status = 'native_lifecycle_behavior_mismatch_review_required';
  outcome.observations[1].observedState = 'active_cached';
  const record = buildKb014FixtureEvidenceRecord({...binding, outcome});
  const parsed = JSON.parse(record.observedResult);
  assert.equal(parsed.cases[1].observedState, 'active_cached');
  assert.equal(parsed.automaticPass, false);
  assert.notEqual(record.observationSha256, buildKb014FixtureEvidenceRecord({...binding, outcome:complete()}).observationSha256);
});

test('partial, blocked, untrusted, and fabricated policy observations are never ledger candidates', () => {
  const invalid = [
    { ...complete(), status:'blocked' },
    { ...complete(), observations:complete().observations.slice(0,3) },
    { ...complete(), automaticPass:true },
    { ...complete(), approvedInventoryReconciled:true },
    { ...complete(), receivingServiceAuthorizationTested:true },
    { ...complete(), observations:complete().observations.map((x,i) => i===2 ? {...x, fixtureOnly:false} : x) },
    { ...complete(), observations:complete().observations.map((x,i) => i===2 ? {...x, credentialReference:'real-token'} : x) },
    { ...complete(), observations:complete().observations.map((x,i) => i===2 ? {...x, receivingPolicyObserved:true} : x) },
    { ...complete(), observations:[...complete().observations].reverse() }
  ];
  for (const outcome of invalid) {
    assert.throws(() => buildKb014FixtureEvidenceRecord({...binding,outcome}));
  }
});

test('wrong digest, ROE, actor, snapshot, revision or time does not produce a receipt', () => {
  const invalid = [
    {checkDigest:'0'.repeat(63)}, {roeReference:'unverified:test'},
    {testerId:''}, {snapshotId:'another-control'},
    {targetRevision:'c'.repeat(39)},
    {probeCompletedAt:'2026-11-03T16:39:00.000Z'},
    {startedAt:'not-a-date'}
  ];
  for (const item of invalid) {
    assert.throws(() => buildKb014FixtureEvidenceRecord({...binding,...item,outcome:complete()}));
  }
});

test('workflow persists complete native cases atomically as inconclusive unverified evidence only', () => {
  const source=readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  // KB-014 native OAuth probes are fixture/integration evidence only.');
  const end=source.indexOf("  if (request.startsWith('Execute authorised active control test '))",start);
  assert.ok(start>0 && end>start);
  const route=source.slice(start,end);
  for (const guard of [
    "detail?.chain?.currentStage!=='test'",
    "detail?.testDefinition?.id!=='ARL-CHK-014'",
    "requiredCases:KB014_CASES",
    "verificationState==='verified'",
    "buildKb014FixtureEvidenceRecord",
    "current?.testDefinition?.digest!==detail.testDefinition.digest",
    "currentRoe.length!==1",
    "db.transaction(async()=>",
    "recordControlTestExecution",
    "recordControlEvidence",
    "sourceType:'kb014_native_oauth_fixture'",
    "evidenceClass:'test_generated'",
    "result:'inconclusive'",
    "evidence.verificationState!=='unverified'",
    "kb014RecordedFixture:receipt",
    "No automatic PASS, FAIL, criterion acceptance or deployment decision"
  ]) assert.ok(route.includes(guard), guard);
  const transactionStart = route.indexOf('db.transaction(async()=>');
  const executionWrite = route.indexOf("const execution=await recordControlTestExecution", transactionStart);
  const evidenceWrite = route.indexOf("const evidence=await recordControlEvidence", executionWrite);
  const receiptReturn = route.indexOf("return {canonicalData:{kb014ActiveTest:outcome,kb014RecordedFixture:receipt", evidenceWrite);
  assert.ok(transactionStart > 0);
  assert.ok(executionWrite > transactionStart);
  assert.ok(evidenceWrite > executionWrite);
  assert.ok(receiptReturn > evidenceWrite);
  assert.ok(route.indexOf("buildKb014FixtureEvidenceRecord")>route.indexOf("executeKb014NativeLifecycleProbe"));
  assert.ok(!route.includes("result:'passed'"));
  assert.ok(!route.includes("result:'failed'"));
  assert.ok(!route.includes("verifyExplicitHumanEvidence({projectId:options.projectId,\n        evidenceId:execution.id"));
});
