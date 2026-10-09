// Evidence work planning is read-only. This module never decides whether a control passes.
export const ASSESSMENT_EVIDENCE_BATCH_SIZE = 20;
const ELIGIBLE_LANES = ['evidence_collection', 'test_planning'];
const SUMMARY_KEYS = [
  'staticCandidates', 'staticMissing', 'humanRequirements',
  'runtimeRequirements', 'sourceLineageIssues'
];

export function buildAssessmentEvidenceBatchIndex(queue) {
  if (!queue?.complete || !queue.systemSnapshotId || !queue.lanes)
    throw new Error('Complete authoritative current-snapshot control queue required.');

  const selected = ELIGIBLE_LANES.flatMap(lane => {
    const items = queue.lanes[lane];
    if (!Array.isArray(items)) throw new Error('Authoritative queue lanes required.');
    return items.map(item => ({...item, lane}));
  }).sort((a, b) => String(a.controlId).localeCompare(String(b.controlId)));

  const ids = selected.map(item => item.controlId);
  if (ids.some(id => !/^ARL-KB-\\d{3}$/.test(id)) ||
      new Set(ids).size !== ids.length)
    throw new Error('Control queue contains malformed or duplicate eligible identities.');

  const batches = [];
  for (let at = 0; at < ids.length; at += ASSESSMENT_EVIDENCE_BATCH_SIZE) {
    const work = selected.slice(at, at + ASSESSMENT_EVIDENCE_BATCH_SIZE);
    batches.push({
      number: batches.length + 1,
      controlIds: work.map(item => item.controlId),
      testPlanning: work.filter(item => item.lane === 'test_planning').length,
      evidenceCollection: work.filter(item => item.lane === 'evidence_collection').length
    });
  }

  return {
    schema: 'arl.agent.assessment-evidence-batch-index.v1',
    systemSnapshotId: queue.systemSnapshotId,
    queueTotal: queue.total,
    eligibleControls: ids.length,
    batchSize: ASSESSMENT_EVIDENCE_BATCH_SIZE,
    batchCount: batches.length,
    batches,
    excludedControls: queue.total - ids.length,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export function summarizeAssessmentEvidenceBatches(index, triages) {
  if (!index?.systemSnapshotId || !Array.isArray(index.batches) ||
      index.batches.length !== index.batchCount ||
      !Array.isArray(triages) || triages.length !== index.batchCount)
    throw new Error('Exact complete assessment evidence triage batches required.');

  const totals = Object.fromEntries(SUMMARY_KEYS.map(key => [key, 0]));
  const attention = [];
  const batches = index.batches.map((batch, i) => {
    const triage = triages[i];
    const ids = triage?.controls?.map(item => item.controlId);
    if (triage?.systemSnapshotId !== index.systemSnapshotId ||
        !Array.isArray(ids) ||
        ids.length !== batch.controlIds.length ||
        ids.some((id, j) => id !== batch.controlIds[j]) ||
        triage.summary?.controls !== batch.controlIds.length ||
        triage.securityStateChanged !== false ||
        triage.deploymentDecisionWritten !== false ||
        triage.controls.some(item => item.passInferred !== false ||
          item.executionAuthorised !== false))
      throw new Error('Batch identities, frozen snapshot, or security boundaries mismatch.');

    for (const key of SUMMARY_KEYS) {
      const value = triage.summary[key];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid evidence triage count: ' + key);
      totals[key] += value;
    }

    for (const control of triage.controls) {
      if (control.summary?.sourceLineageIssues || control.summary?.staticMissing) {
        attention.push({
          controlId: control.controlId,
          batch: batch.number,
          sourceLineageIssues: control.summary.sourceLineageIssues,
          staticMissing: control.summary.staticMissing
        });
      }
    }

    return {
      number: batch.number,
      firstControl: ids[0],
      lastControl: ids[ids.length - 1],
      controlCount: ids.length,
      counts: Object.fromEntries(SUMMARY_KEYS.map(key => [key, triage.summary[key]]))
    };
  });

  if (batches.reduce((total, batch) => total + batch.controlCount, 0) !== index.eligibleControls)
    throw new Error('Incomplete assessment evidence control coverage.');

  return {
    schema: 'arl.agent.assessment-evidence-summary.v1',
    systemSnapshotId: index.systemSnapshotId,
    queueTotal: index.queueTotal,
    eligibleControls: index.eligibleControls,
    excludedControls: index.excludedControls,
    batchSize: index.batchSize,
    batchCount: index.batchCount,
    batches,
    totals,
    attention: attention.slice(0, 15),
    attentionTotal: attention.length,
    evidencePromoted: 0,
    testsExecuted: 0,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    interpretation: 'Candidates are only observed metadata requiring review; they are not verified evidence or criteria satisfied.'
  };
}
