import crypto from 'node:crypto';

import { buildPilotBatchPlan } from './pilot-batch-plan.mjs';
import { buildPilotEvidenceLineageTriage } from './pilot-evidence-lineage-triage.mjs';

const MAX_CONTROLS = 20;
const ELIGIBLE_LANES = new Set(['test_planning', 'evidence_collection']);

function uniqueRows(rows) {
  const result = new Map();
  for (const row of rows) {
    if (row?.id && !result.has(row.id)) result.set(row.id, row);
  }
  return [...result.values()];
}

function instructionForCriterion(criterion) {
  if (criterion.mode === 'machine_collectable') {
    return criterion.candidateEvidenceIds.length
      ? 'Verify linked source provenance, exact target and criterion coverage; the observation is not proof of compliance.'
      : 'Inspect approved frozen-source observations or request the missing version-bound source evidence.';
  }
  if (criterion.mode === 'human_only') {
    return 'Request the attributable organisational record and accountable reviewer decision; do not infer approval.';
  }
  if (criterion.mode === 'active_test_or_runtime') {
    return 'Plan a separately authorised bounded test with expected/observed behaviour; do not execute it from this dossier.';
  }
  return 'Human must classify the requirement and determine what evidence is needed.';
}

function dossierForControl(item, detail, triage, snapshotId) {
  if (!detail?.control?.id || detail.control.id !== item.controlId ||
      detail.systemSnapshot?.id !== snapshotId ||
      triage.controlId !== item.controlId ||
      triage.passInferred !== false ||
      triage.executionAuthorised !== false ||
      triage.requirementCount !== triage.criteria.length) {
    throw new Error('Review dossier rejects mismatched identity, snapshot, or inferred security authority.');
  }

  const testDefinition = detail.testDefinition || {};
  const required = testDefinition.requiredEvidence;
  if (!testDefinition.id || !testDefinition.digest ||
      !Array.isArray(required) || !required.length ||
      typeof testDefinition.objective !== 'string' || !testDefinition.objective.trim() ||
      typeof testDefinition.method !== 'string' || !testDefinition.method.trim() ||
      typeof testDefinition.passCondition !== 'string' || !testDefinition.passCondition.trim() ||
      typeof testDefinition.failCondition !== 'string' || !testDefinition.failCondition.trim()) {
    throw new Error('Review dossier requires complete authoritative control test definition.');
  }
  if (triage.criteria.length !== required.length) {
    throw new Error('Canonical criterion count differs from authoritative test definition.');
  }

  const criteria = triage.criteria.map((criterion, n) => {
    if (criterion.requirementIndex !== n + 1 ||
        criterion.requirement !== required[n] ||
        criterion.criterionSatisfied !== false ||
        !Array.isArray(criterion.candidateEvidenceIds)) {
      throw new Error('Review dossier criterion identity or authority mismatch.');
    }
    return {
      requirementIndex: criterion.requirementIndex,
      requirement: criterion.requirement,
      mode: criterion.mode,
      reviewState: criterion.reviewState,
      existingEvidenceCandidates: [...criterion.candidateEvidenceIds],
      expectedCollectors: [...criterion.expectedCollectors],
      observedCollectors: [...criterion.observedCollectors],
      operatorAction: instructionForCriterion(criterion),
      criterionSatisfied: false,
      humanDecisionRequired: true
    };
  });

  const allEvidenceRows = uniqueRows([...(detail.evidence || []), ...(detail.evidenceHistory || [])]);
  const allTestRows = uniqueRows([...(detail.tests || []), ...(detail.testHistory || [])]);
  if (allEvidenceRows.some(row => row.controlId !== item.controlId) ||
      allTestRows.some(row => row.controlId !== item.controlId)) {
    throw new Error('Review dossier refuses cross-control test or evidence lineage.');
  }

  const evidence = allEvidenceRows
    .map(row => ({
      id: row.id,
      controlId: row.controlId,
      testExecutionId: row.testExecutionId || null,
      sourceType: row.sourceType || null,
      evidenceClass: row.evidenceClass || null,
      verificationState: row.verificationState || 'unknown',
      trustReason: row.trustReason || null,
      retentionStatus: row.retentionStatus || null,
      snapshotCurrent: row.systemSnapshotId === snapshotId,
      isCandidateOnly: true
    }));

  const tests = allTestRows
    .map(row => ({
      id: row.id,
      controlId: row.controlId,
      checkId: row.checkId,
      checkDigestMatches: row.checkDigest === testDefinition.digest,
      snapshotCurrent: row.systemSnapshotId === snapshotId,
      result: row.result || null,
      executionMethod: row.executionMethod || null,
      executionKind: row.executionKind || null,
      findingId: row.findingId || null
    }));

  const sourceExceptions = triage.sourceRecords
    .filter(row =>
      row.lineageStatus !== 'linked_static_observation_unverified_for_criterion' &&
      row.lineageStatus !== 'legacy_static_collection_requires_manual_review')
    .map(row => ({
      evidenceId: row.evidenceId,
      lineageStatus: row.lineageStatus
    }));

  const summary = {
    criteria: criteria.length,
    sourceMetadataCandidates: criteria.filter(row =>
      row.reviewState === 'static_observation_candidate_review_required').length,
    missingStaticMetadata: criteria.filter(row =>
      row.reviewState === 'static_observation_missing').length,
    requiresHumanDocuments: criteria.filter(row =>
      row.mode === 'human_only').length,
    requiresSeparateRuntimeAuthorisation: criteria.filter(row =>
      row.mode === 'active_test_or_runtime').length,
    currentUnverifiedEvidence: evidence.filter(row =>
      row.snapshotCurrent && row.verificationState !== 'verified').length,
    currentVerifiedEvidenceRecords: evidence.filter(row =>
      row.snapshotCurrent && row.verificationState === 'verified').length,
    sourceLineageExceptions: sourceExceptions.length
  };

  return {
    controlId: item.controlId,
    title: detail.control.title || null,
    currentStage: item.currentStage,
    chainStatus: item.chainStatus,
    deploymentImpact: item.deploymentImpact,
    testDefinition: {
      id: testDefinition.id,
      digest: testDefinition.digest,
      objective: testDefinition.objective,
      method: testDefinition.method,
      passCondition: testDefinition.passCondition,
      failCondition: testDefinition.failCondition,
      limitations: testDefinition.limitations || null
    },
    criteria,
    evidenceInventory: evidence,
    testInventory: tests,
    sourceLineageExceptions: sourceExceptions,
    summary,
    outcome: 'operator_review_required',
    applicabilityChanged: false,
    evidenceAutomaticallyAccepted: false,
    findingAutomaticallyClosed: false,
    deploymentDecisionWritten: false
  };
}

export function buildAssessmentReviewDossiers({queue, details, controlIds} = {}) {
  if (!queue?.complete || !queue.systemSnapshotId ||
      !Array.isArray(controlIds) || !controlIds.length || controlIds.length > MAX_CONTROLS ||
      new Set(controlIds).size !== controlIds.length ||
      !Array.isArray(details) || details.length !== controlIds.length) {
    throw new Error('Review dossiers require a complete snapshot and unique bounded control list.');
  }

  const queueItems = new Map(Object.values(queue.lanes || {}).flat()
    .filter(row => row?.controlId).map(row => [row.controlId, row]));
  for (const id of controlIds) {
    if (!/^ARL-KB-\d{3}$/.test(id) ||
        !ELIGIBLE_LANES.has(queueItems.get(id)?.lane)) {
      throw new Error('Review dossier control is not independently actionable.');
    }
  }
  const detailIds = details.map(row => row?.control?.id);
  if (new Set(detailIds).size !== details.length ||
      detailIds.some(id => !controlIds.includes(id))) {
    throw new Error('Review dossier details contain duplicates or unrequested controls.');
  }

  const plan = buildPilotBatchPlan(queue, details, controlIds);
  const triage = buildPilotEvidenceLineageTriage(plan, details);
  const detailById = new Map(details.map(detail => [detail.control.id, detail]));
  const triageById = new Map(triage.controls.map(row => [row.controlId, row]));

  const dossiers = controlIds.map(id =>
    dossierForControl(queueItems.get(id), detailById.get(id), triageById.get(id), queue.systemSnapshotId));
  const revision = details[0].systemSnapshot?.assessmentConfiguration?.targetBinding?.revision || null;
  if (details.some(row =>
    (row.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision || null) !== revision)) {
    throw new Error('Review dossier target binding changed across the requested controls.');
  }

  const payload = {
    schema: 'arl.agent.assessment-review-dossiers.v1',
    systemSnapshotId: queue.systemSnapshotId,
    targetRevision: revision,
    controlCount: dossiers.length,
    controlIds: [...controlIds],
    dossiers,
    decisionPolicy: 'All requirements are awaiting human evaluation; source metadata and recorded verified evidence do not by themselves establish criterion coverage.',
    testsExecuted: 0,
    evidencePersisted: 0,
    evidenceAutomaticallyVerified: 0,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };

  return {
    ...payload,
    preparationDigestSha256: crypto.createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
  };
}
