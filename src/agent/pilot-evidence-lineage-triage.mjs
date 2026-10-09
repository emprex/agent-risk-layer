import { buildCanonicalEvidenceRequirementPlan } from './canonical-evidence-requirement-plan.mjs';

const SOURCE_V2 = 'arl_frozen_source_evidence_collection_v2';
const MARKER = 'Requirement-specific deterministic observations:\n';
const END = '\nThis collection does not assert that any canonical requirement is satisfied';
const REF_PATTERN = /^arl_frozen_source_evidence_collection_v2:([0-9a-f]{40}):(ARL-KB-\d{3}):([0-9a-f]{64})$/;

function uniqueById(records) {
  const seen = new Map();
  for (const record of records) {
    if (record?.id && !seen.has(record.id)) seen.set(record.id, record);
  }
  return [...seen.values()];
}

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function structuredObservations(test) {
  const text = test?.observedResult || '';
  const start = text.indexOf(MARKER);
  if (start < 0) return { status: 'structured_observation_missing', observations: [] };
  const begin = start + MARKER.length;
  const end = text.indexOf(END, begin);
  if (end < 0) return { status: 'structured_observation_truncated', observations: [] };
  try {
    const parsed = JSON.parse(text.slice(begin, end).trim());
    if (parsed?.schema !== 'arl.deterministic-evidence-collection.v1' ||
        !Array.isArray(parsed?.requirementObservations) ||
        !/^[0-9a-f]{40}$/.test(parsed?.targetRevision || '')) {
      return { status: 'invalid_structured_observation', observations: [] };
    }
    return {
      status: 'parsed',
      revision: parsed.targetRevision,
      observations: parsed.requirementObservations.filter(item =>
        typeof item?.requirement === 'string' &&
        Array.isArray(item?.collectors) &&
        item.observations && typeof item.observations === 'object' &&
        !Array.isArray(item.observations))
    };
  } catch {
    return { status: 'invalid_or_truncated_json', observations: [] };
  }
}

function reviewSource(evidence, tests, detail, snapshotId) {
  const summary = {
    evidenceId: evidence.id,
    sourceType: evidence.sourceType || null,
    verificationState: evidence.verificationState || 'unknown',
    testExecutionId: evidence.testExecutionId || null,
    lineageStatus: 'not_a_structured_frozen_collector',
    observedCriterionIndexes: [],
    observations: []
  };
  if (evidence.sourceType !== SOURCE_V2) {
    if (evidence.sourceType === 'arl_frozen_source_evidence_collection') {
      summary.lineageStatus = 'legacy_static_collection_requires_manual_review';
    }
    return summary;
  }
  const test = tests.find(item => item.id === evidence.testExecutionId);
  if (!test) {
    summary.lineageStatus = 'linked_test_missing';
    return summary;
  }
  if (evidence.systemSnapshotId !== snapshotId ||
      test.systemSnapshotId !== snapshotId ||
      evidence.controlId !== detail.control.id ||
      test.controlId !== detail.control.id ||
      test.checkId !== detail.testDefinition?.id ||
      !test.checkDigest ||
      test.checkDigest !== detail.testDefinition?.digest ||
      test.executionMethod !== SOURCE_V2 ||
      test.result !== 'inconclusive' ||
      test.executionKind === 'retest' ||
      evidence.sourceReference !== test.inputReference) {
    summary.lineageStatus = 'source_test_or_check_lineage_mismatch';
    return summary;
  }
  const reference = REF_PATTERN.exec(test.inputReference || '');
  if (!reference || reference[2] !== detail.control.id) {
    summary.lineageStatus = 'invalid_frozen_source_reference';
    return summary;
  }
  const expectedRevision = detail.systemSnapshot?.versionIdentifier;
  if (/^[0-9a-f]{40}$/.test(expectedRevision || '') &&
      expectedRevision !== reference[1]) {
    summary.lineageStatus = 'target_revision_mismatch';
    return summary;
  }
  const parsed = structuredObservations(test);
  if (parsed.status !== 'parsed') {
    summary.lineageStatus = parsed.status;
    return summary;
  }
  if (parsed.revision !== reference[1]) {
    summary.lineageStatus = 'observation_revision_mismatch';
    return summary;
  }
  summary.lineageStatus = 'linked_static_observation_unverified_for_criterion';
  summary.observations = parsed.observations;
  return summary;
}

export function buildPilotEvidenceLineageTriage(plan, details) {
  if (!plan?.systemSnapshotId || !Array.isArray(plan.controls) || !plan.controls.length ||
      plan.controlCount !== plan.controls.length)
    throw new Error('Complete snapshot-bound pilot plan required.');
  const detailsById = new Map(details.map(detail => [detail?.control?.id, detail]));
  const controls = plan.controls.map(item => {
    const detail = detailsById.get(item.controlId);
    if (!detail || detail.systemSnapshot?.id !== plan.systemSnapshotId)
      throw new Error('Cannot triage evidence across different snapshots.');
    const testRows = uniqueById([...(detail.tests || []), ...(detail.testHistory || [])]);
    const evidenceRows = uniqueById([...(detail.evidence || []), ...(detail.evidenceHistory || [])])
      .filter(evidence => evidence.systemSnapshotId === plan.systemSnapshotId &&
        evidence.retentionStatus === 'active');
    const sources = evidenceRows.map(e => reviewSource(e, testRows, detail, plan.systemSnapshotId));
    const requirements = buildCanonicalEvidenceRequirementPlan(detail.testDefinition?.requiredEvidence || []);
    const criteria = requirements.map((entry, i) => {
      const candidateIds = [];
      const observedCollectorIds = new Set();
      if (entry.mode === 'machine_collectable') {
        for (const source of sources) {
          if (source.lineageStatus !== 'linked_static_observation_unverified_for_criterion') continue;
          const matching = source.observations.filter(record =>
            normalized(record.requirement) === normalized(entry.requirement));
          const present = matching.flatMap(record => (record.collectors || []).filter(id =>
            entry.collectors.includes(id) && Object.hasOwn(record.observations, id)));
          if (present.length) {
            candidateIds.push(source.evidenceId);
            present.forEach(id => observedCollectorIds.add(id));
          }
        }
      }
      return {
        requirementIndex: i + 1,
        requirement: entry.requirement,
        mode: entry.mode,
        expectedCollectors: entry.collectors,
        observedCollectors: [...observedCollectorIds].sort(),
        candidateEvidenceIds: candidateIds,
        reviewState: entry.mode === 'machine_collectable'
          ? candidateIds.length ? 'static_observation_candidate_review_required' : 'static_observation_missing'
          : entry.mode === 'human_only' ? 'accountable_human_evidence_required'
          : entry.mode === 'active_test_or_runtime' ? 'authorised_runtime_evidence_required'
          : 'manual_triage_required',
        criterionSatisfied: false
      };
    });
    const identifiedIssues = sources.filter(source =>
      source.lineageStatus !== 'linked_static_observation_unverified_for_criterion' &&
      source.lineageStatus !== 'legacy_static_collection_requires_manual_review');
    return {
      controlId: item.controlId,
      chainStatus: item.chainStatus,
      requirementCount: criteria.length,
      criteria,
      sourceRecords: sources.map(({observations, ...record}) => record),
      summary: {
        staticCandidates: criteria.filter(c => c.reviewState === 'static_observation_candidate_review_required').length,
        staticMissing: criteria.filter(c => c.reviewState === 'static_observation_missing').length,
        humanRequirements: criteria.filter(c => c.mode === 'human_only').length,
        runtimeRequirements: criteria.filter(c => c.mode === 'active_test_or_runtime').length,
        sourceLineageIssues: identifiedIssues.length
      },
      passInferred: false,
      executionAuthorised: false
    };
  });
  const summary = {
    controls: controls.length,
    staticCandidates: controls.reduce((n,c) => n + c.summary.staticCandidates, 0),
    staticMissing: controls.reduce((n,c) => n + c.summary.staticMissing, 0),
    humanRequirements: controls.reduce((n,c) => n + c.summary.humanRequirements, 0),
    runtimeRequirements: controls.reduce((n,c) => n + c.summary.runtimeRequirements, 0),
    sourceLineageIssues: controls.reduce((n,c) => n + c.summary.sourceLineageIssues, 0)
  };
  return {
    schema: 'arl.agent.pilot-evidence-lineage-triage.v1',
    systemSnapshotId: plan.systemSnapshotId,
    summary,
    controls,
    note: 'A linked deterministic source observation is metadata only, not verified criterion coverage. Explicit human review and separate authorised tests remain required.',
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
