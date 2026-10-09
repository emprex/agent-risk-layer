import crypto from 'node:crypto';

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

function frozenInspectionObservation({
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

  return encoded.length <= 5000
    ? encoded
    : JSON.stringify({
        ...observation,
        findings:
          findingProjection.slice(0, 8),
        observedTechnologies:
          observation.observedTechnologies.slice(0, 20)
      }).slice(0, 5000);
}

// Preserve the complete structured payload or refuse to persist it.
export function boundedDeterministicEvidenceJson(evidence, maxLength = 12000) {
  const serialized = JSON.stringify(evidence);
  if (typeof serialized !== 'string' || serialized.length > maxLength) return null;
  return serialized;
}

export async function runAuthoritativeControlSourceReview({
  repositoryPath,
  projectId,
  userId,
  controlId,
  requirements = [],
  collectionOnly = false
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

  const observedFacts =
    frozenInspectionObservation({
      frozen,
      requirements: normalizedRequirements
    });

  const deterministicEvidence =
    collectDeterministicEvidence({
      repositoryPath,
      frozen,
      requirements: normalizedRequirements
    });

  const deterministicEvidenceText =
    boundedDeterministicEvidenceJson(deterministicEvidence);

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

  const inputReference =
    `${collectionKind}:${frozen.target.revision}:${controlId}:${sourceDigest}`;

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
        observedResult:
          [
            'ARL completed deterministic frozen-source inspection for this control.',
            'Observed frozen-target facts:',
            observedFacts,
            'Requirement-specific deterministic observations:',
            deterministicEvidenceText,
            'This collection does not assert that any canonical requirement is satisfied and does not infer PASS/FAIL.'
          ].join('\n'),
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

  return {
    executed: true,
    effect: 'authoritative_control_source_review_recorded',
    securityStateChanged: true
  };
}
