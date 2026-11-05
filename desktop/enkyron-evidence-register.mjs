// NEMORYTH: read-only, snapshot-bound *recorded* evidence metadata for ENKYRON.
// Stored digest is not independently verified proof; no source payload is exposed.
const CONTROL = /^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const TICKET = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function validatedEvidenceRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.ticket_id !== 'string' || !TICKET.test(value.ticket_id) ||
      typeof value.control_id !== 'string' || !CONTROL.test(value.control_id)) {
    throw new Error('Invalid evidence register request');
  }
  return {ticketId: value.ticket_id, controlId: value.control_id};
}

/**
 * Read one bounded register page only after the same DB transaction has verified
 * the latest authoritative master document and target/snapshot binding.
 * loadMaster is the existing ENKYRON verified master reader (injected for tests).
 */
export async function readEvidenceRegister(client, request, loadMaster) {
  const {ticketId, controlId} = validatedEvidenceRequest(request);
  if (typeof loadMaster !== 'function') throw new Error('Missing master verifier');
  const master = await loadMaster(client, ticketId);
  if (!master?.available || master?.integrity !== 'verified') {
    return {available:false, reason:'Verified assessment master is unavailable'};
  }
  if (master.snapshot_status !== 'current') {
    return {available:false, reason:'Master snapshot is not current'};
  }
  if (!master.project_id || !master.assessment_id || !master.snapshot_id ||
      !/^[0-9a-f]{40}$/.test(master.target_sha || '')) {
    throw new Error('Master identity is incomplete');
  }

  // Do not query source_reference, raw descriptor_json, customer content or
  // token-bearing fields. Do not read evidence from a different frozen snapshot.
  const rows = (await client.query(`
    SELECT id,entry_id,system_snapshot_id,evidence_class,source_type,
           verification_state,retention_status,integrity_digest,
           observed_at,created_at,test_execution_id,runtime_event_id,
           approval_id
    FROM control_evidence_items
    WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3
    ORDER BY created_at DESC,id DESC LIMIT 101
  `, [master.project_id, master.snapshot_id, controlId])).rows;

  const tests = (await client.query(`
    SELECT id,entry_id,system_snapshot_id,execution_kind,result,
           started_at,completed_at,retest_of_execution_id,
           original_snapshot_id,finding_id,remediation_id,content_digest
    FROM control_test_executions
    WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3
    ORDER BY started_at DESC,id DESC LIMIT 101
  `, [master.project_id, master.snapshot_id, controlId])).rows;

  // Redundant identity verification protects the presentation layer even if a
  // query or DB adapter changes. Neither recorded digest is recomputed here.
  for (const item of [...rows, ...tests]) {
    if (item.entry_id !== controlId || item.system_snapshot_id !== master.snapshot_id) {
      throw new Error('Evidence or test history scope mismatch');
    }
  }

  // Return index metadata, never artefacts, test inputs, observations or a
  // derived control PASS/FAIL. Recorded test result is historical status only.
  return {
    available:true, control_id:controlId, project_id:master.project_id,
    assessment_id:master.assessment_id, snapshot_id:master.snapshot_id,
    target_sha:master.target_sha, integrity:'master_verified',
    items:rows.slice(0,100).map(row=>({
      id:row.id, entry_id:row.entry_id, snapshot_id:row.system_snapshot_id,
      evidence_class:row.evidence_class, source_type:row.source_type,
      verification_state:row.verification_state,
      retention_status:row.retention_status,
      recorded_integrity_digest:row.integrity_digest,
      observed_at:row.observed_at, created_at:row.created_at,
      test_execution_id:row.test_execution_id,
      runtime_event_id:row.runtime_event_id,
      approval_id:row.approval_id
    })),
    more:rows.length>100,
    tests:tests.slice(0,100).map(row=>({
      id:row.id, entry_id:row.entry_id, snapshot_id:row.system_snapshot_id,
      execution_kind:row.execution_kind, recorded_result:row.result,
      started_at:row.started_at, completed_at:row.completed_at,
      retest_of_execution_id:row.retest_of_execution_id,
      original_snapshot_id:row.original_snapshot_id,
      finding_id:row.finding_id, remediation_id:row.remediation_id,
      recorded_content_digest:row.content_digest
    })),
    more_tests:tests.length>100,
    evidence_accepted:false, tests_executed:0,
    security_verdict:'not_assessed', readiness_decision:'not_evaluated',
    human_review_required:true,
    notice:'Recorded evidence and test metadata only; stored digests and test results are not independent verification.'
  };
}
