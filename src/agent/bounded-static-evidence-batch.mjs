// Deterministic, bounded execution plan derived from the authoritative
// current-snapshot queue. No security result or test authorisation is implied.
export function planStaticEvidenceBatch(index, batchNumber, snapshotId) {
  if (!index || index.schema !== 'arl.agent.assessment-evidence-batch-index.v1' ||
      index.systemSnapshotId !== snapshotId ||
      !Number.isSafeInteger(batchNumber) || batchNumber < 1 ||
      !Array.isArray(index.batches) || index.batchCount !== index.batches.length ||
      index.batchSize !== 20 ||
      index.securityStateChanged !== false ||
      index.deploymentDecisionWritten !== false ||
      index.humanReviewRequired !== true)
    throw new Error('Static persistence requires an exact authoritative bounded batch index.');
  const batch=index.batches[batchNumber-1];
  const ids=batch?.controlIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 ||
      new Set(ids).size !== ids.length ||
      ids.some(id=>!/^ARL-KB-\d{3}$/.test(id)))
    throw new Error('Static persistence batch identity invalid or outside bounds.');
  const across=index.batches.flatMap(b=>b.controlIds || []);
  if (across.length !== index.eligibleControls ||
      new Set(across).size !== across.length ||
      index.eligibleControls + index.excludedControls !== index.queueTotal)
    throw new Error('Static persistence requires complete non-overlapping eligible scope.');
  return Object.freeze({
    schema:'arl.agent.bounded-static-persistence-plan.v1',
    systemSnapshotId:snapshotId,batchNumber,
    controlIds:Object.freeze([...ids]),
    requested:ids.length,
    outcome:'not_executed',
    humanReviewRequired:true,passFailInferred:false,
    deploymentDecisionWritten:false
  });
}
