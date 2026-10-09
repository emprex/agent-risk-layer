export function buildControlWorkQueue(pages) {
  const first = pages[0];
  if (!first?.systemSnapshot?.id) throw new Error('Current authoritative snapshot required.');
  const snapshotId = first.systemSnapshot.id;
  const seen = new Map();
  const expectedTotal = first.total;
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0)
    throw new Error('Authoritative queue requires an exact non-negative control total.');
  for (const page of pages) {
    if (page.systemSnapshot?.id !== snapshotId || page.total !== expectedTotal)
      throw new Error('Snapshot or control count changed while reading control queue.');
    if (!Array.isArray(page.items)) throw new Error('Authoritative page has no control list.');
    for (const item of page.items) {
      if (!/^ARL-KB-\\d{3}$/.test(item?.controlId || ''))
        throw new Error('Authoritative control item has invalid identity.');
      if (seen.has(item.controlId)) {
        const prior = seen.get(item.controlId);
        if (JSON.stringify(prior) !== JSON.stringify(item))
          throw new Error('Conflicting duplicate control record across authoritative pages.');
        continue;
      }
      seen.set(item.controlId, item);
    }
  }
  if (pages.at(-1)?.hasMore === true)
    throw new Error('Authoritative control queue pagination is incomplete.');
  const controls = [...seen.values()].sort((a,b) => a.controlId.localeCompare(b.controlId));
  const work = controls.map(item => {
    const stage = item.currentStage || null;
    const chainStatus = item.chainStatus || null;
    const held = item.deploymentImpact === 'blocker' ||
      ['finding_open', 'remediation_in_progress'].includes(chainStatus) ||
      ['remediation', 'retest'].includes(stage);
    const lane = held ? 'follow_up_blocked' :
      stage === 'applicability' ? 'human_applicability' :
      stage === 'test' ? 'test_planning' :
      stage === 'evidence' ? 'evidence_collection' :
      ['approval', 'deployment_decision'].includes(stage) ? 'human_decision' :
      'review_required';
    return {
      controlId: item.controlId,
      currentStage: stage,
      chainStatus,
      deploymentImpact: item.deploymentImpact || null,
      lane,
      nextAction: item.nextAction || null
    };
  });
  const lanes = Object.fromEntries(
    ['follow_up_blocked','human_applicability','test_planning','evidence_collection','human_decision','review_required']
      .map(lane => [lane, work.filter(item => item.lane === lane)])
  );
  return {
    schema: 'arl.agent.control-work-queue.v1',
    systemSnapshotId: snapshotId,
    total: work.length,
    expectedTotal,
    complete: work.length === expectedTotal,
    lanes,
    controlIds: work.map(item => item.controlId),
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
