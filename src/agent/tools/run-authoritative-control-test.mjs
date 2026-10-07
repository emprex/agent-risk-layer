import crypto from 'node:crypto';

import {
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution
} from '../../control-intelligence.js';

import {
  inspectFrozenRepository
} from './inspect-frozen-repository.mjs';

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

  const collectionKind =
    collectionOnly
      ? 'arl_frozen_source_evidence_collection'
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
            normalizedRequirements.length
              ? `Canonical requirements supported by this collection: ${normalizedRequirements.join(' | ')}`
              : 'No canonical requirement was asserted as satisfied by source inspection alone.',
            'The collection records observations only. It does not infer a PASS/FAIL result.'
          ].join(' '),
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
        'Observed evidence is limited to deterministic frozen-source inspection. Human-supplied governance evidence remains separate and must not be inferred by ARL.'
    }
  });

  return {
    executed: true,
    effect: 'authoritative_control_source_review_recorded',
    securityStateChanged: true
  };
}
