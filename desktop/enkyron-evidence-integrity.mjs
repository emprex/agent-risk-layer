// Read-only inspection of one recorded KB-001 source candidate.
// This checks canonical descriptor consistency and *claimed* Git lineage.
// It does NOT independently authenticate source material, approve evidence,
// or change verificationState, applicability, Master, or test permissions.
import {canonicalJson,intelligenceDigest} from '../src/control-intelligence-core.js';

const CONTROL='ARL-KB-001';
const ID=/^cei_[a-f0-9]{32}$/;
const TICKET=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const SOURCE=/^frozen-git:([a-f0-9]{40}):KB001:1:([a-f0-9]{64})$/;
function refuse(){throw new Error('KB-001 integrity review blocked: record, snapshot or source provenance not consistent');}
function iso(v) {
  if(v instanceof Date) return v.toISOString();
  if(typeof v !== 'string')refuse();
  return v;
}
export function validateKb001IntegrityRequest(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     !TICKET.test(input.ticket_id||'') ||
     input.control_id!==CONTROL ||
     !ID.test(input.evidence_id||'')) refuse();
  return {ticket_id:input.ticket_id,control_id:CONTROL,evidence_id:input.evidence_id};
}

export function inspectKb001EvidenceRow(row,master) {
  if (!row || !master?.available || master.integrity!=='verified' ||
      master.snapshot_status!=='current' ||
      !master.project_id || !master.assessment_id || !master.snapshot_id ||
      !SHA.test(master.target_sha||'') ||
      row.project_id!==master.project_id ||
      row.system_snapshot_id!==master.snapshot_id ||
      row.entry_id!==CONTROL ||
      row.evidence_class!=='observed' ||
      row.source_type!=='arl_frozen_source_candidate' ||
      row.verification_state!=='unverified' ||
      row.retention_status!=='active' ||
      row.test_execution_id!==null ||
      row.runtime_event_id!==null ||
      row.approval_id!==null ||
      row.remediation_artifact_id!==null ||
      row.finding_id!==null ||
      row.remediation_id!==null ||
      !HEX.test(row.integrity_digest||'') ||
      typeof row.descriptor_json!=='string')
    refuse();

  let stored;
  try {stored=JSON.parse(row.descriptor_json);}catch{refuse();}
  if(!stored || typeof stored!=='object' || Array.isArray(stored) ||
     stored.schema!=='arl.control-evidence.v2') refuse();

  // Reconstruct the canonical descriptor from authoritative record columns,
  // following ARL's own descriptorFromEvidence integrity rules. Reuse the
  // canonicalJson and intelligenceDigest utilities, never an invented hash.
  const normalized={
    ...stored,
    workspaceId:row.workspace_id,
    projectId:row.project_id,
    systemSnapshotId:row.system_snapshot_id,
    controlId:row.entry_id,
    testExecutionId:row.test_execution_id||null,
    findingId:row.finding_id||null,
    runtimeEventId:row.runtime_event_id||null,
    approvalId:row.approval_id||null,
    remediationArtifactId:row.remediation_artifact_id||null,
    remediationId:row.remediation_id||null,
    evidenceClass:row.evidence_class,
    sourceType:row.source_type,
    sourceReference:row.source_reference,
    observedAt:iso(row.observed_at),
    collectorId:row.collector_id||null,
    sensitivityClassification:row.sensitivity_classification,
    retentionStatus:row.retention_status,
    verificationState:row.verification_state,
    limitations:row.limitations
  };
  if(canonicalJson(stored)!==canonicalJson(normalized) ||
     intelligenceDigest(normalized)!==row.integrity_digest)refuse();

  const source=SOURCE.exec(row.source_reference||'');
  if(!source || source[1]!==master.target_sha ||
     stored.sourceDigest!==null ||
     typeof row.limitations!=='string' ||
     !row.limitations.includes('UNVERIFIED STATIC METADATA ONLY') ||
     !row.limitations.includes('Collector: target_identity; KB-001 requirement 1.') ||
     !row.limitations.includes('Frozen Git revision: '+master.target_sha) ||
     !row.limitations.includes('Projection SHA256: '+source[2]))refuse();
  const collectionDigest=/Collection SHA256: ([a-f0-9]{64})/.exec(row.limitations);
  if(!collectionDigest)refuse();

  return {
    available:true,
    schema:'enkyron.kb001.integrity-readonly.v1',
    evidence_id:row.id,
    ticket_id:master.ticket_id||null,
    control_id:CONTROL,
    criterion_number:1,
    assessment_id:master.assessment_id,
    snapshot_id:master.snapshot_id,
    target_sha:master.target_sha,
    record_integrity:'descriptor_digest_consistent',
    source_reference_binding:'recorded_sha_matches_master',
    provenance_type:'frozen_git_target_identity',
    projection_sha256:source[2],
    collection_sha256:collectionDigest[1],
    source_material_replay:'not_performed',
    original_source_authenticated:false,
    approved_environment_verified:false,
    owner_approvals_verified:false,
    verification_state:'unverified',
    evidence_accepted:false,
    control_verdict:'not_assessed',
    master_modified:false,
    tests_executed:0,
    human_review_required:true,
    notice:'Stored descriptor and row columns match the canonical ARL hash and recorded frozen SHA. This is NOT independent authentication of the original Git content, collection output or deployment approvals; no evidence trust promotion.'
  };
}

/** Must run within the same read-only repeatable-read DB transaction as the Master lookup. */
export async function readKb001EvidenceIntegrity(client,request,masterReader) {
  const input=validateKb001IntegrityRequest(request);
  if(typeof masterReader!=='function')refuse();
  const master=await masterReader(client,input.ticket_id);
  if(!master?.available || master.integrity!=='verified' ||
     master.snapshot_status!=='current')refuse();
  const res=await client.query(
    'SELECT id,workspace_id,project_id,system_snapshot_id,entry_id,'+
    'test_execution_id,finding_id,evidence_class,source_type,source_reference,'+
    'runtime_event_id,approval_id,remediation_artifact_id,remediation_id,'+
    'observed_at,collector_id,integrity_digest,descriptor_json,'+
    'sensitivity_classification,retention_status,verification_state,limitations '+
    'FROM control_evidence_items '+
    'WHERE id=$1 AND project_id=$2 AND system_snapshot_id=$3 AND entry_id=$4 LIMIT 1',
    [input.evidence_id,master.project_id,master.snapshot_id,CONTROL]
  );
  const row=res.rows?.[0];
  if(!row || res.rows.length!==1 || row.id!==input.evidence_id)refuse();
  return {...inspectKb001EvidenceRow(row,master),ticket_id:input.ticket_id};
}
