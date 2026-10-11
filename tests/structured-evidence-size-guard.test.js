import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedDeterministicEvidenceJson, frozenInspectionObservation, isLegacyTruncatedKb007Source, boundedStructuredSourceProjection, kb007ProviderRefreshReference } from '../src/agent/tools/run-authoritative-control-test.mjs';

const payload = {
  schema: 'arl.deterministic-evidence-collection.v1',
  targetRevision: 'a'.repeat(40),
  requirementObservations: [{
    requirement: 'ARL-KB-008 assessed system, exact version, environment and applicable data/human-interaction scope',
    collectors: ['target_identity'],
    observations: {target_identity: {revision: 'a'.repeat(40)}}
  }]
};

test('bounded structured evidence preserves a complete parseable payload', () => {
  const text = boundedDeterministicEvidenceJson(payload);
  assert.equal(text, JSON.stringify(payload));
  assert.deepEqual(JSON.parse(text), payload);
});

test('boundary accepts exact length and rejects one character below size', () => {
  const size = JSON.stringify(payload).length;
  assert.equal(boundedDeterministicEvidenceJson(payload, size), JSON.stringify(payload));
  assert.equal(boundedDeterministicEvidenceJson(payload, size - 1), null);
});

test('oversized structured evidence is rejected rather than truncated', () => {
  const huge = {...payload, requirementObservations: [
    ...payload.requirementObservations,
    {requirement:'extra',collectors:['source_and_configuration'],observations:{source_and_configuration:{detail:'x'.repeat(20000)}}}
  ]};
  assert.equal(boundedDeterministicEvidenceJson(huge), null);
  assert.deepEqual(payload.requirementObservations.length, 1);
});

test('small frozen inspection summary stays parseable', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{schema:'v1', observedTechnologies:['python']}},
    requirements:['system version']
  });
  assert.equal(JSON.parse(text).targetRevision, 'a'.repeat(40));
});

test('large frozen inspection summary is reduced without creating partial JSON', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{
      observedTechnologies: Array.from({length:60}, (_,i)=>({name:'provider'+i, note:'x'.repeat(150)}))
    }},
    requirements:[]
  });
  assert.equal(typeof text, 'string');
  assert.ok(text.length <= 5000);
  assert.deepEqual(JSON.parse(text).observedTechnologies.length, 20);
});

test('oversized fallback summary fails closed', () => {
  const text = frozenInspectionObservation({
    frozen: {target:{revision:'a'.repeat(40)}, inspection:{
      observedTechnologies: Array.from({length:60}, (_,i)=>({name:'provider'+i, note:'x'.repeat(750)}))
    }}
  });
  assert.equal(text, null);
});


test('KB-007 recollection is eligible only for an exact-bound legacy truncated v2 record',()=>{
  const inputReference='arl_frozen_source_evidence_collection_v2:'+'a'.repeat(40)+':ARL-KB-007:'+'b'.repeat(64);
  const expected={inputReference,snapshotId:'sys_exact',checkDigest:'digest_exact'};
  const sample={
    ...expected,systemSnapshotId:expected.snapshotId,
    executionMethod:'arl_frozen_source_evidence_collection_v2',
    controlId:'ARL-KB-007',result:'inconclusive',executionKind:'initial',
    observedResult:'Observed frozen-target facts:\n{}'
  };
  assert.equal(isLegacyTruncatedKb007Source(sample,expected),true);
  assert.equal(isLegacyTruncatedKb007Source({...sample,systemSnapshotId:'wrong'},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...sample,inputReference:'other'},expected),false);
  const priorInspectionDigest='d'.repeat(64);
  const historical={...sample,inputReference:
    'arl_frozen_source_evidence_collection_v2:'+'a'.repeat(40)+':ARL-KB-007:'+priorInspectionDigest};
  assert.equal(isLegacyTruncatedKb007Source(historical,expected),true,
    'historical inspection digests must not prevent recovery on the same frozen SHA');
  assert.equal(isLegacyTruncatedKb007Source({...historical,controlId:'ARL-KB-008'},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...historical,result:'passed'},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...historical,executionKind:'retest'},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...historical,inputReference:
    'arl_frozen_source_evidence_collection_v2:'+'c'.repeat(40)+':ARL-KB-007:'+priorInspectionDigest},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...sample,checkDigest:'stale'},expected),false);
  assert.equal(isLegacyTruncatedKb007Source({...sample,executionMethod:'manual_review'},expected),false);
  const complete={...sample,observedResult:
    'Requirement-specific deterministic observations:\n'+JSON.stringify(payload)+
    '\nThis collection does not assert that any canonical requirement is satisfied'};
  assert.equal(isLegacyTruncatedKb007Source(complete,expected),false);
});


test('KB-007 oversized observations become explicit incomplete metadata, never accepted evidence',()=>{
  const large={
    ...payload,
    requirementObservations:[
      {requirement:'ARL-KB-007 observed model, MCP, plugin, API and other provider inventory',
       collectors:['architecture_and_inventory'],
       observations:{architecture_and_inventory:{
         mcpAndToolReferenceFiles:Array.from({length:40},(_,i)=>({
           pathHash:String(i).padStart(24,'0'),
           basename:'synthetic-file-'+i+'-'.repeat(300)
         })),
         discoveryCoverage:{completeTrackedAndTextScan:false, trackedFileScanCapped:true}
       }}}
    ]
  };
  assert.equal(boundedDeterministicEvidenceJson(large),null);
  const projected=boundedStructuredSourceProjection(large);
  assert.ok(projected.text && projected.text.length<=12000);
  assert.equal(projected.limited,true);
  const parsed=JSON.parse(projected.text);
  assert.equal(parsed.schema,large.schema);
  assert.equal(parsed.targetRevision,large.targetRevision);
  assert.equal(parsed.projection.incomplete,true);
  assert.match(parsed.projection.warning,/NOT evidence/);
  assert.match(parsed.projection.fullCollectionSha256,/^[0-9a-f]{64}$/);
  const observed=parsed.requirementObservations[0].observations.architecture_and_inventory;
  assert.equal(observed.mcpAndToolReferenceFiles.originalCount,40);
  assert.equal(observed.mcpAndToolReferenceFiles.incomplete,true);
  assert.equal(observed.discoveryCoverage.completeTrackedAndTextScan,false);
  const second=boundedStructuredSourceProjection(large);
  assert.equal(second.text,projected.text);
  assert.deepEqual(large.requirementObservations[0].observations.architecture_and_inventory.mcpAndToolReferenceFiles.length,40);
});

test('even a bounded projection fails closed if required values alone exceed storage',()=>{
  const impossible={...payload,requirementObservations:[{
    requirement:'X'.repeat(15000),collectors:['target_identity'],
    observations:{target_identity:{revision:'a'.repeat(40)}}
  }]};
  assert.equal(boundedStructuredSourceProjection(impossible).text,null);
});

test('KB-007 refresh reference is deterministic, source-specific and bound to exact revision',()=>{
  const input={revision:'a'.repeat(40),controlId:'ARL-KB-007',
    sourceDigest:'b'.repeat(64),boundedObservation:JSON.stringify(payload)};
  const first=kb007ProviderRefreshReference(input);
  assert.match(first,/^arl_frozen_source_evidence_collection_v2:[a-f0-9]{40}:ARL-KB-007:[a-f0-9]{64}$/);
  assert.equal(kb007ProviderRefreshReference(input),first);
  assert.notEqual(kb007ProviderRefreshReference({...input,boundedObservation:input.boundedObservation+' '}),first);
  assert.notEqual(kb007ProviderRefreshReference({...input,sourceDigest:'c'.repeat(64)}),first);
  assert.throws(()=>kb007ProviderRefreshReference({...input,revision:'c'.repeat(39)}),/exact SHA/);
  assert.throws(()=>kb007ProviderRefreshReference({...input,controlId:'ARL-KB-008'}),/exact SHA/);
  assert.throws(()=>kb007ProviderRefreshReference({...input,boundedObservation:'x'.repeat(10501)}),/bounded observations/);
});
