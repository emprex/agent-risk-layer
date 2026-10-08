export function buildControlWorkQueue(pages) {
  const first = pages[0];
  if (!first?.systemSnapshot?.id) throw new Error('Current authoritative snapshot required.');
  const snapshotId = first.systemSnapshot.id;
  const seen = new Map();
  for (const page of pages) {
    if (page.systemSnapshot?.id !== snapshotId) throw new Error('Snapshot changed while reading control queue.');
    for (const item of page.items || []) {
      if (item?.controlId && !seen.has(item.controlId)) seen.set(item.controlId, item);
    }
  }
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
    expectedTotal: first.total,
    complete: work.length === first.total,
    lanes,
    controlIds: work.map(item => item.controlId),
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
