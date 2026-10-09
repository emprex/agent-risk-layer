import crypto from 'node:crypto';
import { collectDeterministicEvidence } from './deterministic-evidence-collector.mjs';

const SHA = /^[a-f0-9]{40}$/;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function assertFrozen(frozen, expectedRevision) {
  if (!SHA.test(expectedRevision || '') ||
      frozen?.binding?.verified !== true ||
      frozen?.target?.revision !== expectedRevision ||
      frozen?.target?.dirty !== false ||
      frozen?.binding?.revisionBefore !== expectedRevision ||
      frozen?.binding?.revisionAfter !== expectedRevision ||
      !frozen?.target?.repositoryPath) {
    throw new Error('Static preview requires verified clean frozen inspection matching exact assessment Git SHA.');
  }
}

export function requiredStaticObservations(review) {
  if (!review?.systemSnapshotId ||
      !Array.isArray(review.staticCollection) ||
      review.securityStateChanged !== false ||
      review.deploymentDecisionWritten !== false ||
      review.boundaries?.passFailInferred !== false ||
      review.boundaries?.runtimeTestingAuthorised !== false) {
    throw new Error('Authoritative read-only evidence request packs required.');
  }
  const tasks = review.staticCollection.flatMap(pack => pack.tasks || []);
  if (!tasks.length) return {requirements: [],tasks: []};
  if (tasks.length > 2000) throw new Error('Static collection request exceeds bounded scope.');
  const deduped = new Map();
  for (const task of tasks) {
    if (!/^ARL-KB-\d{3}$/.test(task.controlId || '') ||
        !Number.isSafeInteger(task.requirementIndex) ||
        task.requirementIndex <= 0 ||
        !clean(task.requirement) ||
        !Array.isArray(task.expectedCollectors) ||
        task.expectedCollectors.length === 0 ||
        !['static_observation_missing','static_observation_candidate_review_required'].includes(task.reviewState)) {
      throw new Error('Malformed canonical static collection task.');
    }
    const key = task.controlId + ':' + task.requirementIndex;
    if (!deduped.has(key)) {
      deduped.set(key, task);
    } else if (clean(deduped.get(key).requirement) !== clean(task.requirement)) {
      throw new Error('Conflicting canonical static collection requirements.');
    }
  }
  const distinct = [...deduped.values()];
  return {
    requirements: [...new Set(distinct.map(task => clean(task.requirement)))],
    tasks: distinct
  };
}

export function buildStaticCollectionPreview({review, collection, expectedRevision}) {
  if (!SHA.test(expectedRevision || '') ||
      collection?.schema !== 'arl.deterministic-evidence-collection.v1' ||
      collection?.targetRevision !== expectedRevision ||
      !Array.isArray(collection.requirementObservations)) {
    throw new Error('Static collection revision/schema mismatch.');
  }
  const {requirements,tasks} = requiredStaticObservations(review);
  const requested = new Set(requirements);
  const byRequirement = new Map();
  for (const record of collection.requirementObservations) {
    const key = clean(record?.requirement);
    if (!requested.has(key) || byRequirement.has(key) ||
        !Array.isArray(record?.collectors) ||
        !record?.observations || typeof record.observations !== 'object') {
      throw new Error('Unexpected, duplicated or malformed deterministic collection observation.');
    }
    byRequirement.set(key, record);
  }
  const criteria = tasks.map(task => {
    const record = byRequirement.get(clean(task.requirement));
    const observedCollectors = record?.collectors?.filter(id =>
      task.expectedCollectors.includes(id) &&
      Object.hasOwn(record.observations, id)) || [];
    return {
      controlId: task.controlId,
      requirementIndex: task.requirementIndex,
      expectedCollectors: [...new Set(task.expectedCollectors)].sort(),
      observedCollectors: [...new Set(observedCollectors)].sort(),
      state: observedCollectors.length
        ? 'static_metadata_collected_for_human_review'
        : 'no_matching_static_metadata',
      criterionSatisfied: false,
      evidenceVerified: false
    };
  });
  const counts = {
    requirements: requirements.length,
    criteria: criteria.length,
    metadataCandidates: criteria.filter(c => c.state === 'static_metadata_collected_for_human_review').length,
    missingStaticMetadata: criteria.filter(c => c.state === 'no_matching_static_metadata').length
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(collection)).digest('hex');
  return {
    schema: 'arl.agent.static-collection-preview.v1',
    systemSnapshotId: review.systemSnapshotId,
    targetRevision: expectedRevision,
    observationDigestSha256: digest,
    counts,
    criteria,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    testsExecuted: 0,
    evidencePersisted: 0,
    evidenceAutomaticallyVerified: 0,
    passFailInferred: false
  };
}

export async function previewStaticCollection({
  repositoryPath, frozenInspection, review, expectedRevision, freezeRepository
}) {
  if (typeof freezeRepository !== 'function') throw new Error('Trusted frozen repository reader required.');
  assertFrozen(frozenInspection, expectedRevision);
  const before = await freezeRepository(repositoryPath);
  if (before.dirty || before.revision !== expectedRevision ||
      before.repositoryPath !== frozenInspection.target.repositoryPath) {
    throw new Error('Target changed before static collection preview.');
  }
  const {requirements} = requiredStaticObservations(review);
  // This existing collector reads source and metadata only. One invocation
  // serves all machine-readable requirements; it never records tests or evidence.
  const collection = collectDeterministicEvidence({
    repositoryPath: before.repositoryPath,
    frozen: frozenInspection,
    requirements
  });
  const after = await freezeRepository(repositoryPath);
  if (after.dirty || after.revision !== expectedRevision ||
      after.repositoryPath !== before.repositoryPath) {
    throw new Error('Target changed during static collection preview.');
  }
  return buildStaticCollectionPreview({review,collection,expectedRevision});
}
