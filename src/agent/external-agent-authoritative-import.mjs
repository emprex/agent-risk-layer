import { createHash } from 'node:crypto';
import { db, id, nowIso } from '../db.js';
import { createSystemSnapshot, recordControlEvidence } from '../control-intelligence.js';
import { parseExternalManifest } from './external-agent-assessment.mjs';
import { verifyExternalObservation } from './external-agent-evidence-review.mjs';

export const EXTERNAL_SNAPSHOT_SOURCE = 'arl_external_black_box';
export const EXTERNAL_TARGET_BINDING_SCHEMA = 'arl.target-binding.external.v1';

const digest = value => createHash('sha256').update(value).digest('hex');
function guard(condition, message) {
  if (!condition) throw new Error('External import blocked: ' + message);
}

export function prepareExternalCandidateImport({ manifestRaw, roeRaw, observationRaw }) {
  const review = verifyExternalObservation({ manifestRaw, roeRaw, observationRaw });
  const { manifest } = parseExternalManifest(manifestRaw);
  const receipt = JSON.parse(observationRaw);
  guard(review.consistency === 'consistent_only' &&
    review.exactManifestAndRoeBinding === true &&
    review.evidenceAccepted === false && review.securityVerdict === 'none' &&
    receipt.target.versionVerified === false &&
    receipt.evidenceStatus === 'candidate_unreviewed',
    'an exact, unreviewed, consistent collection is required');
  const controls = receipt.observations.flatMap(probe =>
    probe.controlIds.map(controlId => ({
      probeId: probe.probeId, controlId, observedAt: probe.observedAtUtc,
      sourceReference: 'external_candidate:' + receipt.collectionId + ':' +
        probe.probeId + ':' + receipt.artifactSha256.slice(0, 16)
    }))
  );
  guard(controls.length >= 1 && controls.length <= 40,
    '1-40 exact probe/control links required');
  return {
    target: manifest.target.name, endpoint: manifest.target.endpoint,
    declaredVersion: manifest.target.version,
    targetFingerprint: digest(JSON.stringify([
      manifest.target.name, manifest.target.endpoint, manifest.target.version
    ])),
    collectionId: receipt.collectionId,
    manifestSha256: receipt.binding.manifestSha256,
    roeSha256: receipt.binding.roeSha256,
    observationSha256: receipt.artifactSha256,
    controls, candidateOnly: true, versionVerified: false,
    permissionsIndependentlyVerified: false,
    securityVerdict: 'none', deploymentDecision: 'hold'
  };
}

export function externalCandidateSnapshotInput(prepared) {
  guard(prepared?.candidateOnly === true && prepared.versionVerified === false &&
    prepared.permissionsIndependentlyVerified === false &&
    prepared.securityVerdict === 'none' &&
    /^[a-f0-9]{64}$/.test(prepared.targetFingerprint || '') &&
    /^[a-f0-9]{64}$/.test(prepared.manifestSha256 || ''),
  'candidate-only target boundary required');
  return {
    architecture: {
      summary: 'Declared external HTTPS agent; deployed release and runtime boundaries are not independently verified.',
      components: []
    },
    models: [], tools: [], identities: [], dataSources: [], networkAccess: [],
    autonomyLevel: 'unknown',
    approvalConfiguration: { status: 'unknown' },
    assessmentConfiguration: {
      profile: 'ARL-RKA-1.2.0', architectureFacts: [],
      targetBinding: {
        schema: EXTERNAL_TARGET_BINDING_SCHEMA, source: 'external_https',
        endpoint: prepared.endpoint, declaredVersion: prepared.declaredVersion,
        targetFingerprint: prepared.targetFingerprint,
        manifestSha256: prepared.manifestSha256,
        versionVerified: false, releaseEvidence: 'not_provided'
      },
      initialContext: {
        mode: 'explicit_unknown_only', architectureInferred: false,
        controlDecisionInferred: false, externalEvidenceAcceptance: 'none'
      }
    },
    source: EXTERNAL_SNAPSHOT_SOURCE
  };
}

// Trusted, authenticated operator-context API only. Never accept userId
// directly from untrusted HTTP input or export this as an identity-taking CLI.
// Imports are strictly candidate/unverified, never a security decision.
export async function importExternalCandidateEvidence({
  projectId, userId, manifestRaw, roeRaw, observationRaw,
  acknowledgeCandidateImport = false
}) {
  guard(acknowledgeCandidateImport === true, 'explicit operator acknowledgement required');
  guard(typeof projectId === 'string' && /^prj_[a-f0-9]{32}$/.test(projectId) &&
    typeof userId === 'string' && /^usr_[a-f0-9]{32}$/.test(userId),
    'trusted local project/user identities required');
  guard(db.kind === 'postgres', 'PostgreSQL is required');
  const candidate = prepareExternalCandidateImport({ manifestRaw, roeRaw, observationRaw });

  return db.transaction(async () => {
    const project = await db.prepare(
      "SELECT p.id,p.workspace_id,p.environment,p.status,m.role " +
      "FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id " +
      "WHERE p.id=? AND m.user_id=? AND m.status='active' FOR UPDATE OF p"
    ).get(projectId, userId);
    guard(project && ['developer','admin','owner'].includes(project.role),
      'project authorisation failed');
    guard(project.environment === 'staging' && project.status === 'active',
      'dedicated active staging project required');

    const old = await db.prepare(
      "SELECT id,source,assessment_configuration_json FROM system_snapshots " +
      "WHERE workspace_id=? AND project_id=? AND status='current'"
    ).get(project.workspace_id, projectId);
    let snapshotId;
    if (old) {
      const binding = JSON.parse(old.assessment_configuration_json)?.targetBinding;
      guard(old.source === EXTERNAL_SNAPSHOT_SOURCE &&
        binding?.schema === EXTERNAL_TARGET_BINDING_SCHEMA &&
        binding.source === 'external_https' &&
        binding.targetFingerprint === candidate.targetFingerprint &&
        binding.manifestSha256 === candidate.manifestSha256 &&
        binding.versionVerified === false,
        'existing snapshot differs or is Git-bound; changed target needs explicit reassessment');
      snapshotId = old.id;
    } else {
      const created = await createSystemSnapshot({
        projectId, userId, input: externalCandidateSnapshotInput(candidate)
      });
      snapshotId = created.snapshot.id;
    }

    const prior = await db.prepare(
      "SELECT id FROM external_agent_candidate_imports " +
      "WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND collection_id=?"
    ).get(project.workspace_id, projectId, snapshotId, candidate.collectionId);
    guard(!prior, 'duplicate collection cannot be imported');

    const importId = id('eai_');
    const at = nowIso();
    await db.prepare(
      "INSERT INTO external_agent_candidate_imports " +
      "(id,workspace_id,project_id,system_snapshot_id,collection_id," +
      "manifest_sha256,roe_sha256,observation_sha256,target_fingerprint," +
      "declared_version,imported_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(importId, project.workspace_id, projectId, snapshotId,
      candidate.collectionId, candidate.manifestSha256, candidate.roeSha256,
      candidate.observationSha256, candidate.targetFingerprint,
      candidate.declaredVersion, userId, at);

    for (const link of candidate.controls) {
      const evidence = await recordControlEvidence({
        projectId, userId, controlId: link.controlId,
        input: {
          systemSnapshotId: snapshotId, evidenceClass: 'imported',
          sourceType: 'external_candidate',
          sourceReference: link.sourceReference,
          observedAt: link.observedAt, sensitivityClassification: 'internal',
          limitations: 'Candidate HTTP observation only. No independently verified owner permission, deployed release, agent effects, or human evidence acceptance.'
        }
      });
      guard(evidence.verificationState === 'unverified' &&
        evidence.systemSnapshotId === snapshotId,
        'canonical evidence boundary mismatch');
      await db.prepare(
        "INSERT INTO external_agent_candidate_control_links " +
        "(id,import_id,workspace_id,project_id,system_snapshot_id," +
        "control_id,probe_id,evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(id('eal_'), importId, project.workspace_id, projectId, snapshotId,
        link.controlId, link.probeId, evidence.id, at);
    }

    return {
      schema: 'arl.external-agent-candidate-import.v1',
      projectId, snapshotId, importId,
      targetFingerprint: candidate.targetFingerprint,
      observationSha256: candidate.observationSha256,
      declaredVersion: candidate.declaredVersion,
      versionVerified: false,
      candidateEvidenceCount: candidate.controls.length,
      evidenceVerification: 'unverified',
      candidateOnly: true, securityVerdict: 'none',
      confirmedFindings: 0, deploymentDecision: 'hold',
      humanReviewRequired: true
    };
  });
}
