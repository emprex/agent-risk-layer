import {
  summarizeAssessmentEvidenceBatches
} from './assessment-evidence-batch-index.mjs';

// Collection themes are coordination aids, not evidence-reuse or acceptance decisions.
const HUMAN_THEMES = Object.freeze([
  ['privacy_and_legal_records', /\b(?:privacy|legal[- ]basis|personal[- ]data|rights[- ]handling|notice|transparency|retention)\b/i],
  ['asset_and_provider_registers', /\b(?:inventory|register|declared assets?|provider record|credential record)\b/i],
  ['accountable_review_and_approvals', /\b(?:reviewer|tester identity|accountable|approval|sign[- ]off|decision record)\b/i],
  ['governance_and_operations_documents', /\b(?:policy|documented|governance|change[- ]control|fallback|rollback|recovery)\b/i]
]);

function humanTheme(requirement) {
  for (const [name, pattern] of HUMAN_THEMES) {
    if (pattern.test(requirement)) return name;
  }
  return 'other_human_evidence';
}

function add(map, key, task) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(task);
}

function packetsFromGroups(map, prefix) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([theme, tasks]) => ({
      packId: prefix + ':' + theme,
      theme,
      taskCount: tasks.length,
      controlCount: new Set(tasks.map(task => task.controlId)).size,
      controlIds: [...new Set(tasks.map(task => task.controlId))].sort(),
      tasks
    }));
}

function referenceTask(controlId, criterion) {
  return {
    controlId,
    requirementIndex: criterion.requirementIndex,
    requirement: criterion.requirement,
    reviewState: criterion.reviewState,
    candidateEvidenceIds: criterion.candidateEvidenceIds,
    expectedCollectors: criterion.expectedCollectors
  };
}

export function buildAssessmentEvidenceReviewPacks(index, triages) {
  // This rejects partial batches, changed snapshots, mismatched IDs, and any
  // test-execution or verdict authority before a review pack is constructed.
  const summary = summarizeAssessmentEvidenceBatches(index, triages);
  const staticGroups = new Map();
  const humanGroups = new Map();
  const runtimeGroups = new Map();
  const otherGroups = new Map();
  const exceptions = [];
  const observed = new Set();
  let criterionCount = 0;

  for (const triage of triages) {
    for (const control of triage.controls) {
      if (!Array.isArray(control.criteria) ||
          control.requirementCount !== control.criteria.length ||
          !Array.isArray(control.sourceRecords)) {
        throw new Error('Complete criterion details and source lineage required.');
      }

      for (const criterion of control.criteria) {
        criterionCount += 1;
        if (!Number.isSafeInteger(criterion.requirementIndex) ||
            criterion.requirementIndex <= 0 ||
            typeof criterion.requirement !== 'string' ||
            !criterion.requirement.trim() ||
            !Array.isArray(criterion.candidateEvidenceIds) ||
            !Array.isArray(criterion.expectedCollectors) ||
            criterion.criterionSatisfied !== false ||
            !['machine_collectable', 'human_only', 'active_test_or_runtime', 'unclassified'].includes(criterion.mode)) {
          throw new Error('Malformed or judgment-bearing canonical criterion.');
        }

        const identity = control.controlId + ':' + criterion.requirementIndex;
        if (observed.has(identity)) throw new Error('Duplicate criterion identity.');
        observed.add(identity);
        const task = referenceTask(control.controlId, criterion);

        if (criterion.mode === 'machine_collectable') {
          if (!['static_observation_candidate_review_required', 'static_observation_missing'].includes(criterion.reviewState) ||
              criterion.expectedCollectors.length === 0) {
            throw new Error('Machine evidence request has invalid collector or review status.');
          }
          for (const collector of [...new Set(criterion.expectedCollectors)]) {
            add(staticGroups, collector, task);
          }
        } else if (criterion.mode === 'human_only') {
          if (criterion.reviewState !== 'accountable_human_evidence_required' ||
              criterion.candidateEvidenceIds.length) throw new Error('Human criterion has invalid evidence authority.');
          add(humanGroups, humanTheme(criterion.requirement), task);
        } else if (criterion.mode === 'active_test_or_runtime') {
          if (criterion.reviewState !== 'authorised_runtime_evidence_required' ||
              criterion.candidateEvidenceIds.length) throw new Error('Runtime criterion cannot inherit static trust.');
          add(runtimeGroups, 'separate_authorisation_required', task);
        } else {
          if (criterion.reviewState !== 'manual_triage_required')
            throw new Error('Unclassified criterion requires review.');
          add(otherGroups, 'unclassified_review', task);
        }
      }

      for (const source of control.sourceRecords) {
        if (source.lineageStatus !== 'linked_static_observation_unverified_for_criterion' &&
            source.lineageStatus !== 'legacy_static_collection_requires_manual_review') {
          exceptions.push({
            controlId: control.controlId,
            evidenceId: source.evidenceId,
            lineageStatus: source.lineageStatus
          });
        }
      }
    }
  }

  const staticCollection = packetsFromGroups(staticGroups, 'static-source');
  const humanDocumentation = packetsFromGroups(humanGroups, 'human-documentation');
  const runtimeValidation = packetsFromGroups(runtimeGroups, 'runtime-validation');
  const manualReview = packetsFromGroups(otherGroups, 'manual-triage');

  return {
    schema: 'arl.agent.assessment-evidence-review-packs.v1',
    systemSnapshotId: summary.systemSnapshotId,
    assessmentControls: summary.eligibleControls,
    excludedControls: summary.excludedControls,
    criterionCount,
    summary: {
      ...summary.totals,
      staticSourcePackets: staticCollection.length,
      humanDocumentPackets: humanDocumentation.length,
      runtimeValidationPackets: runtimeValidation.length,
      manualReviewPackets: manualReview.length,
      lineageExceptions: exceptions.length
    },
    staticCollection,
    humanDocumentation,
    runtimeValidation,
    manualReview,
    lineageExceptions: exceptions,
    boundaries: {
      sharedPacketDoesNotImplySharedEvidenceValidity: true,
      criteriaRemainControlSpecific: true,
      humanDecisionsRemainSeparate: true,
      runtimeTestingAuthorised: false,
      evidenceAccepted: false,
      passFailInferred: false
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
