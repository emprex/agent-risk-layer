import crypto from 'node:crypto';
import { db } from '../../db.js';
import { storeSourceCollectionArtifact } from './source-collection-artifacts.mjs';

import {
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution
} from '../../control-intelligence.js';

import {
  inspectFrozenRepository
} from './inspect-frozen-repository.mjs';

import {
  collectDeterministicEvidence
} from '../deterministic-evidence-collector.mjs';

export function frozenInspectionObservation({
  frozen,
  requirements = []
} = {}) {
  const inspection = frozen?.inspection || {};

  const findingProjection =
    (inspection.findings || [])
      .slice(0, 20)
      .map((item) => ({
        ruleId: item?.ruleId || null,
        severity: item?.severity || null,
        title: item?.title || null,
        evidenceCount:
          Array.isArray(item?.evidence)
            ? item.evidence.length
            : 0
      }));

  const observation = {
    targetRevision:
      frozen?.target?.revision || null,
    inspector: {
      schema: inspection?.schema || null,
      bundleId: inspection?.bundleId || null,
      scannerVersion:
        inspection?.scanner?.version || null,
      policyVersion:
        inspection?.scanner?.policyVersion || null
    },
    subject: {
      projectName:
        inspection?.subject?.projectName || null,
      environment:
        inspection?.subject?.environment || null,
      gitRevision:
        inspection?.subject?.gitRevision || null
    },
    scope: {
      mode: inspection?.scope?.mode || null,
      filesDiscovered:
        inspection?.scope?.filesDiscovered ?? null,
      filesInspected:
        inspection?.scope?.filesInspected ?? null,
      sourceCoverage:
        inspection?.scope?.sourceCoverage || null
    },
    summary: inspection?.summary || null,
    observedTechnologies:
      Array.isArray(inspection?.observedTechnologies)
        ? inspection.observedTechnologies
        : [],
    attestations:
      inspection?.attestations || null,
    integrityDigest:
      inspection?.integrity?.digest || null,
    findings: findingProjection,
    canonicalRequirementsObservedAgainst:
      (Array.isArray(requirements)
        ? requirements
        : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
  };

  const encoded = JSON.stringify(observation);

  if (encoded.length <= 5000) return encoded;

  // A shortened summary is still required to be valid JSON. Refuse
  // oversized summaries instead of persisting an unparsable fragment.
  const reduced = JSON.stringify({
    ...observation,
    findings: findingProjection.slice(0, 8),
    observedTechnologies: observation.observedTechnologies.slice(0, 20)
  });
  return reduced.length <= 5000 ? reduced : null;
}

// Preserve the complete structured payload or refuse to persist it.
export function boundedDeterministicEvidenceJson(evidence, maxLength = 12000) {
  const serialized = JSON.stringify(evidence);
  if (typeof serialized !== 'string' || serialized.length > maxLength) return null;
  return serialized;
}

// On large repositories, duplicate inventory arrays across several KB criteria
// exceed the canonical 12k test-observation budget. Projection must remain
// demonstrably incomplete, never silently claim exhaustive inventory coverage.
export function boundedStructuredSourceProjection(collection, maxLength = 12000) {
  const full = boundedDeterministicEvidenceJson(collection, maxLength);
  if (full !== null) return {text:full, limited:false};
  const originalDigest = crypto.createHash('sha256')
    .update(JSON.stringify(collection)).digest('hex');
  const project = (value, limit) => {
    if (Array.isArray(value)) return {
      // A typed marker distinguishes a partial inventory from an entire list.
      items:value.slice(0,limit).map(item => project(item,limit)),
      originalCount:value.length,
      omittedCount:Math.max(0,value.length-limit),
      incomplete:value.length>limit
    };
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key,item])=>[key,project(item,limit)])
    );
    return value;
  };
  for (const limit of [8,4,2,1,0]) {
    const candidate={
      schema:collection?.schema,
      targetRevision:collection?.targetRevision,
      privacyBoundary:collection?.privacyBoundary,
      projection:{
        incomplete:true,
        inventoryArraysTruncated:true,
        fullCollectionSha256:originalDigest,
        limitPerArray:limit,
        warning:'Partial inventory metadata only; omitted records are NOT evidence that no providers or paths exist.'
      },
      requirementObservations:(collection?.requirementObservations||[]).map(item=>({
        requirement:item.requirement,
        collectors:item.collectors,
        observations:Object.fromEntries(
          Object.entries(item.observations||{}).map(([id,value])=>[id,project(value,limit)])
        )
      }))
    };
    const text=boundedDeterministicEvidenceJson(candidate,maxLength);
    if (text !== null) return {text,limited:true};
  }
  return {text:null,limited:true};
}

export function kb007ProviderRefreshReference({revision,controlId,sourceDigest,boundedObservation} = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision || '') || controlId !== 'ARL-KB-007' ||
      !/^[a-f0-9]{64}$/.test(sourceDigest || '') ||
      typeof boundedObservation !== 'string' || !boundedObservation.length ||
      boundedObservation.length > 10500) {
    throw new Error('KB-007 refresh requires exact SHA, source lineage and bounded observations.');
  }
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({sourceDigest,boundedObservation,
      purpose:'kb007-provider-inventory-refresh-v1'}))
    .digest('hex');
  return `arl_frozen_source_evidence_collection_v2:${revision}:${controlId}:${digest}`;
}


export function kb017DependencyRefreshReference({
  revision, controlId, sourceDigest, checkDigest, collection
} = {}) {
  const dep = collection?.requirementObservations
    ?.flatMap(item => Object.values(item.observations || {}))
    ?.find(item => item?.dependencyInventory)?.dependencyInventory;
  if (controlId !== 'ARL-KB-017' ||
      !/^[a-f0-9]{40}$/.test(revision || '') ||
      !/^[a-f0-9]{64}$/.test(sourceDigest || '') ||
      !/^[a-f0-9]{64}$/.test(checkDigest || '') ||
      collection?.schema !== 'arl.deterministic-evidence-collection.v1' ||
      collection.targetRevision !== revision ||
      dep?.parserStatus !== 'completed' ||
      dep.sourceCandidates !== dep.filesSentToParser ||
      dep.parsed?.filesParsed !== dep.sourceCandidates ||
      dep.parsed?.filesInvalid !== 0 || dep.parsed?.filesUnsupported !== 0 ||
      dep.skippedForBudget !== 0 || dep.unreadableFiles !== 0 ||
      dep.componentRetentionComplete !== true || dep.parsed?.omittedComponents !== 0 ||
      dep.buildArtifactVerified !== false ||
      dep.deployedArtifactVerified !== false ||
      dep.modelProvenanceVerified !== false || dep.sbomComplete !== false) {
    throw new Error('KB-017 refresh requires complete static source candidates and exact frozen identity, not deployment certification.');
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    purpose:'kb017-dependency-source-refresh-v1',revision,controlId,
    sourceDigest,checkDigest,
    fullCollectionSha256:crypto.createHash('sha256')
      .update(JSON.stringify(collection)).digest('hex')
  })).digest('hex');
  return 'arl_frozen_source_evidence_collection_v2:' + revision + ':' +
    controlId + ':' + digest;
}


export function isLegacyTruncatedKb007Source(test, {
  inputReference, snapshotId, checkDigest, targetRevision, controlId = 'ARL-KB-007'
} = {}) {
  const revision = targetRevision || /^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):/.exec(inputReference || '')?.[1];
  const ref = /^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):(ARL-KB-007):([a-f0-9]{64})$/.exec(test?.inputReference || '');
  return Boolean(ref && revision && ref[1] === revision &&
    controlId === 'ARL-KB-007' &&
    test.controlId === controlId &&
    test.systemSnapshotId === snapshotId &&
    test.executionMethod === 'arl_frozen_source_evidence_collection_v2' &&
    test.checkDigest === checkDigest &&
    test.result === 'inconclusive' &&
    test.executionKind !== 'retest' &&
    typeof test.observedResult === 'string' &&
    (!test.observedResult.includes('Requirement-specific deterministic observations:\n') ||
     !test.observedResult.includes('\nThis collection does not assert that any canonical requirement is satisfied')));
}

export function isMissingKb008StructuredObservations(test, {snapshotId, checkId, checkDigest, revision} = {}) {
  return Boolean(test?.controlId === 'ARL-KB-008' &&
    test.systemSnapshotId === snapshotId &&
    test.checkId === checkId && test.checkDigest === checkDigest &&
    test.executionMethod === 'arl_frozen_source_evidence_collection_v2' &&
    test.result === 'inconclusive' && test.executionKind !== 'retest' &&
    /^arl_frozen_source_evidence_collection_v2:[a-f0-9]{40}:ARL-KB-008:[a-f0-9]{64}$/.test(test.inputReference || '') &&
    test.inputReference.split(':')[1] === revision &&
    typeof test.observedResult === 'string' &&
    !test.observedResult.includes('Requirement-specific deterministic observations:\n'));
}

// Recovery eligibility is deliberately snapshot/check/SHA-bound and never trusts
// the caller's claim that a prior observation is malformed.
export function isLegacyIncompleteV2Source(test, {
  snapshotId, checkId, revision, controlId
} = {}) {
  if (!/^ARL-KB-\d{3}$/.test(controlId || '') ||
      !/^[a-f0-9]{40}$/.test(revision || '')) return false;
  const ref = /^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):(ARL-KB-\d{3}):([a-f0-9]{64})$/
    .exec(test?.inputReference || '');
  if (!ref || ref[1] !== revision || ref[2] !== controlId ||
      test?.controlId !== controlId ||
      test?.systemSnapshotId !== snapshotId ||
      test?.checkId !== checkId ||
      // A historical check digest may differ after a canonical KB update.
      // It identifies a stale *historical* record, never current coverage.
      !/^[a-f0-9]{64}$/.test(test?.checkDigest || '') ||
      test?.executionMethod !== 'arl_frozen_source_evidence_collection_v2' ||
      test?.result !== 'inconclusive' ||
      test?.executionKind === 'retest' ||
      typeof test?.observedResult !== 'string') return false;
  const start = 'Requirement-specific deterministic observations:\n';
  const end = '\nThis collection does not assert that any canonical requirement is satisfied';
  const text = test.observedResult;
  const a = text.indexOf(start);
  const b = a < 0 ? -1 : text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) return true;
  try {
    const payload = JSON.parse(text.slice(a + start.length, b).trim());
    return payload?.schema !== 'arl.deterministic-evidence-collection.v1' ||
      payload?.targetRevision !== revision ||
      !Array.isArray(payload?.requirementObservations);
  } catch {
    return true;
  }
}

// A stale check digest is historical, not current evidence. Refresh only
// when every other test/reference identity matches the frozen snapshot.
export function isStaleCheckDigestV2Source(test, {
  snapshotId,checkId,checkDigest,revision,controlId
}={}) {
  const ref=/^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):(ARL-KB-\d{3}):([a-f0-9]{64})$/.exec(test?.inputReference || '');
  return Boolean(ref && ref[1] === revision && ref[2] === controlId &&
    /^ARL-KB-\d{3}$/.test(controlId || '') &&
    /^[a-f0-9]{64}$/.test(checkDigest || '') &&
    /^[a-f0-9]{64}$/.test(test?.checkDigest || '') &&
    test.checkDigest !== checkDigest &&
    test.systemSnapshotId === snapshotId && test.controlId === controlId &&
    test.checkId === checkId &&
    test.executionMethod === 'arl_frozen_source_evidence_collection_v2' &&
    test.result === 'inconclusive' && test.executionKind !== 'retest');
}

export async function runAuthoritativeControlSourceReview({
  repositoryPath,
  projectId,
  userId,
  controlId,
  requirements = [],
  collectionOnly = false,
  repairTruncatedSource = false,
  refreshProviderSource = false,
  refreshKb017DependencySource = false,
  repairKb008Source = false,
  repairLegacyV2Source = false,
  refreshStaleCheckDigestSource = false
} = {}) {
  if (!repositoryPath || !projectId || !userId || !controlId) {
    return {
      executed: false,
      reason: 'authoritative_control_source_review_context_required'
    };
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId,
      userId
    });

  if (detail?.chain?.currentStage !== 'test') {
    return {
      executed: false,
      reason: 'authoritative_control_test_stage_required'
    };
  }

  const frozen =
    await inspectFrozenRepository(repositoryPath);

  const snapshotId = detail?.systemSnapshot?.id || null;
  if (
    !snapshotId ||
    frozen?.binding?.verified !== true ||
    !frozen?.target?.revision
  ) {
    return {
      executed: false,
      reason: 'authoritative_frozen_source_review_required'
    };
  }


  if (refreshKb017DependencySource) {
    const binding = detail.systemSnapshot?.assessmentConfiguration?.targetBinding;
    const known = [...(detail.tests || []), ...(detail.testHistory || [])];
    const requiredPrefix =
      'arl_frozen_source_evidence_collection_v2:' +
      frozen.target.revision + ':ARL-KB-017:';
    if (controlId !== 'ARL-KB-017' || collectionOnly !== true ||
        refreshStaleCheckDigestSource || refreshProviderSource ||
        repairKb008Source || repairLegacyV2Source || repairTruncatedSource ||
        frozen.target.dirty !== false ||
        binding?.source !== 'git' ||
        binding.revision !== frozen.target.revision ||
        detail.testDefinition?.id !== 'ARL-CHK-017' ||
        !/^[a-f0-9]{64}$/.test(detail.testDefinition?.digest || '') ||
        !Array.isArray(detail.testDefinition?.requiredEvidence) ||
        !known.some(test =>
          test.controlId === controlId &&
          test.checkId === detail.testDefinition.id &&
          test.systemSnapshotId === snapshotId &&
          test.executionMethod === 'arl_frozen_source_evidence_collection_v2' &&
          test.result === 'inconclusive' &&
          test.executionKind !== 'retest' &&
          typeof test.inputReference === 'string' &&
          test.inputReference.startsWith(requiredPrefix) &&
          /^[a-f0-9]{64}$/.test(test.inputReference.slice(requiredPrefix.length)))) {
      return {
        executed:false,reason:'kb017_refresh_requires_prior_source_and_exact_current_frozen_assessment',
        securityStateChanged:false
      };
    }
  }
  if (refreshStaleCheckDigestSource) {
    const config=detail.systemSnapshot?.assessmentConfiguration || {};
    if (collectionOnly !== true || repairLegacyV2Source || repairTruncatedSource ||
        refreshProviderSource || repairKb008Source ||
        config.targetBinding?.source !== 'git' ||
        config.targetBinding.revision !== frozen.target.revision ||
        frozen.target.dirty !== false ||
        detail.testDefinition?.id !== 'ARL-CHK-' + controlId.slice(-3)) {
      return {executed:false,reason:'stale_check_digest_refresh_requires_exact_frozen_snapshot',securityStateChanged:false};
    }
    const records=[...(detail.tests || []),...(detail.testHistory || [])];
    if (!records.some(test=>isStaleCheckDigestV2Source(test,{
      snapshotId,checkId:detail.testDefinition.id,
      checkDigest:detail.testDefinition.digest,
      revision:frozen.target.revision,controlId
    }))) return {executed:false,reason:'stale_check_digest_refresh_not_required',securityStateChanged:false};
  }
  if (repairLegacyV2Source) {
    const config = detail.systemSnapshot?.assessmentConfiguration || {};
    if (collectionOnly !== true || repairTruncatedSource || refreshProviderSource ||
        repairKb008Source || config.targetBinding?.source !== 'git' ||
        config.targetBinding.revision !== frozen.target.revision ||
        frozen.target.dirty !== false ||
        detail.testDefinition?.id !== 'ARL-CHK-' + controlId.slice(-3)) {
      return {executed:false,reason:'legacy_v2_recovery_requires_exact_frozen_snapshot',securityStateChanged:false};
    }
    const records = [...(detail.tests || []), ...(detail.testHistory || [])];
    const eligible = records.some(test => isLegacyIncompleteV2Source(test, {
      snapshotId, checkId:detail.testDefinition.id,
      checkDigest:detail.testDefinition.digest, revision:frozen.target.revision, controlId
    }));
    if (!eligible) return {executed:false,reason:'legacy_v2_recovery_not_required',securityStateChanged:false};
  }
  if (repairKb008Source) {
    const config = detail.systemSnapshot?.assessmentConfiguration || {};
    if (controlId !== 'ARL-KB-008' || collectionOnly !== true ||
        config.targetBinding?.source !== 'git' ||
        config.targetBinding.revision !== frozen.target.revision ||
        frozen.target.dirty !== false ||
        detail.testDefinition?.id !== 'ARL-CHK-008') {
      return {executed:false,reason:'kb008_repair_requires_exact_frozen_snapshot',securityStateChanged:false};
    }
    const records = [...(detail.tests || []),...(detail.testHistory || [])];
    const broken = records.some(test => isMissingKb008StructuredObservations(test, {
      snapshotId,checkId:detail.testDefinition?.id,
      checkDigest:detail.testDefinition?.digest,revision:frozen.target.revision
    }));
    if (!broken) return {executed:false,reason:'kb008_structured_source_repair_not_required',securityStateChanged:false};
  }
  if (repairTruncatedSource || refreshProviderSource) {
    const binding = detail.systemSnapshot?.assessmentConfiguration?.targetBinding;
    if (controlId !== 'ARL-KB-007' || collectionOnly !== true ||
        binding?.source !== 'git' || binding.revision !== frozen.target.revision ||
        frozen.target.dirty !== false) {
      return {executed:false,reason:'kb007_recollection_requires_exact_frozen_snapshot',securityStateChanged:false};
    }
  }

  const sourceDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      revision: frozen.target.revision,
      inspection: frozen.inspection
    }))
    .digest('hex');

  const normalizedRequirements =
    (Array.isArray(requirements) ? requirements : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);

  // The typed collection already carries bounded deterministic observations.
  // Keep the verbose inspector summary only for the distinct source-review mode.
  const observedFacts = collectionOnly ? null : frozenInspectionObservation({
    frozen, requirements: normalizedRequirements
  });

  if (!collectionOnly && observedFacts === null) {
    return {
      executed: false,
      reason: 'frozen_source_observation_exceeds_storage_limit',
      securityStateChanged: false
    };
  }

  const deterministicEvidence =
    collectDeterministicEvidence({
      repositoryPath,
      frozen,
      requirements: normalizedRequirements
    });

  const projection = collectionOnly
    ? boundedStructuredSourceProjection(deterministicEvidence, 10500)
    : {text:boundedDeterministicEvidenceJson(deterministicEvidence),limited:false};
  const deterministicEvidenceText = projection.text;

  // Reject oversized observations before recording a test or evidence item.
  // A sliced JSON document cannot be parsed or independently reviewed.
  if (deterministicEvidenceText === null) {
    return {
      executed: false,
      reason: 'structured_source_observation_exceeds_storage_limit',
      securityStateChanged: false
    };
  }

  const collectionKind =
    collectionOnly
      ? 'arl_frozen_source_evidence_collection_v2'
      : 'arl_frozen_source_review';

  const originalReference =
    `${collectionKind}:${frozen.target.revision}:${controlId}:${sourceDigest}`;
  const knownTests = [
    ...(Array.isArray(detail.tests) ? detail.tests : []),
    ...(Array.isArray(detail.testHistory) ? detail.testHistory : [])
  ];
  const original = knownTests.find(item =>
    isLegacyTruncatedKb007Source(item, {
      targetRevision:frozen.target.revision, snapshotId,
      checkDigest: detail.testDefinition?.digest
    })
  );
  if (repairTruncatedSource && !original) {
    return {executed:false,reason:'kb007_truncated_source_repair_not_required',securityStateChanged:false};
  }
  const repairDigest = crypto.createHash('sha256')
    .update(sourceDigest + ':kb007-v2-bounded-storage-repair-v1')
    .digest('hex');
  // A changed, bounded collector payload gets a distinct append-only source reference.
  // Repeating the exact payload remains idempotent even when the frozen SHA is unchanged.
  const kb008RepairDigest = crypto.createHash('sha256')
    .update(JSON.stringify({
      purpose:'kb008-structured-source-recovery-v1',
      revision:frozen.target.revision,
      sourceDigest, boundedObservation:deterministicEvidenceText
    })).digest('hex');
  const legacyRepairDigest = crypto.createHash('sha256').update(JSON.stringify({
    purpose:'legacy-v2-structured-source-recovery-v1',
    revision:frozen.target.revision, controlId,
    sourceDigest, boundedObservation:deterministicEvidenceText,
    currentCheckDigest:detail.testDefinition?.digest
  })).digest('hex');
  const staleDigestRefreshDigest=crypto.createHash('sha256').update(JSON.stringify({
    purpose:'stale-v2-check-digest-refresh-v1',revision:frozen.target.revision,
    controlId,sourceDigest,boundedObservation:deterministicEvidenceText,
    currentCheckDigest:detail.testDefinition?.digest
  })).digest('hex');
  const inputReference = refreshKb017DependencySource
    ? kb017DependencyRefreshReference({
        revision:frozen.target.revision, controlId, sourceDigest,
        checkDigest:detail.testDefinition?.digest,
        collection:deterministicEvidence
      })
    : refreshStaleCheckDigestSource
    ? `${collectionKind}:${frozen.target.revision}:${controlId}:${staleDigestRefreshDigest}`
    : repairLegacyV2Source
    ? `${collectionKind}:${frozen.target.revision}:${controlId}:${legacyRepairDigest}`
    : repairKb008Source
    ? `${collectionKind}:${frozen.target.revision}:${controlId}:${kb008RepairDigest}`
    : refreshProviderSource
    ? kb007ProviderRefreshReference({
        revision:frozen.target.revision,controlId,sourceDigest,
        boundedObservation:deterministicEvidenceText
      })
    : repairTruncatedSource
      ? `${collectionKind}:${frozen.target.revision}:${controlId}:${repairDigest}`
      : originalReference;

  const previous = [
    ...(Array.isArray(detail.tests) ? detail.tests : []),
    ...(Array.isArray(detail.testHistory) ? detail.testHistory : [])
  ].find(
    (item) =>
      item?.inputReference === inputReference &&
      item?.systemSnapshotId === snapshotId
  );

  if (previous) {
    return {
      executed: true,
      effect: 'authoritative_control_source_review_already_recorded',
      securityStateChanged: false
    };
  }

  const observedResult = [
    'ARL completed deterministic frozen-source inspection for this control.',
    'Observed frozen-target facts:',
    collectionOnly
      ? JSON.stringify({targetRevision:frozen.target.revision,inspectionDigest:sourceDigest})
      : observedFacts,
    'Requirement-specific deterministic observations:',
    deterministicEvidenceText,
    'This collection does not assert that any canonical requirement is satisfied and does not infer PASS/FAIL.'
  ].join('\n');
  if (collectionOnly && observedResult.length > 12000) {
    return {executed:false,reason:'complete_structured_source_observation_exceeds_storage_limit',securityStateChanged:false};
  }

  // The artifact, test and evidence must either all persist or all roll back.
  await db.transaction(async () => {
    // Complete metadata must be durable before the bounded observation becomes evidence.
    // Do not re-collect or repair previously recorded partial observations.
    if (collectionOnly) {
      await storeSourceCollectionArtifact({
        projectId, snapshotId, controlId,
        targetRevision:frozen.target.revision,
        inputReference,
        collection:deterministicEvidence,
        projectionDigest:projection.limited
          ? JSON.parse(deterministicEvidenceText).projection?.fullCollectionSha256
          : null
      });
    }
  
    const execution =
      await recordControlTestExecution({
        projectId,
        controlId,
        userId,
        input: {
          systemSnapshotId: snapshotId,
          executionKind: 'initial',
          executionMethod: collectionKind,
          result: 'inconclusive',
          inputReference,
          observedResult,
          limitations:
            'This automatic source collection is bound to the exact frozen Git revision. It may support canonical evidence requirements but does not invent human approval, reviewer identity, organisational records, runtime effects or a conclusive control result.'
        }
      });
  
    await recordControlEvidence({
      projectId,
      controlId,
      userId,
      input: {
        systemSnapshotId: snapshotId,
        evidenceClass: 'observed',
        sourceType: collectionKind,
        sourceReference: inputReference,
        testExecutionId: execution.id,
        limitations:
          'Observed evidence is limited to deterministic frozen-source inspection and typed repository collectors. Human governance decisions, legal-basis conclusions, runtime effects and active-test outcomes remain separate and must not be inferred by ARL.'
      }
    });
  
  });

  return {
    executed: true,
    effect: 'authoritative_control_source_review_recorded',
    securityStateChanged: true
  };
}
