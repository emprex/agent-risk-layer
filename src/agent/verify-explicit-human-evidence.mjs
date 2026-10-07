import {
  db,
  id,
  nowIso
} from '../db.js';

import {
  intelligenceDigest
} from '../control-intelligence-core.js';

export async function verifyExplicitHumanEvidence({
  projectId,
  evidenceId,
  userId,
  controlId,
  verificationScope = 'explicit_human_review',
  reason = 'Explicit human review verified the submitted manual evidence for the current authoritative snapshot.'
} = {}) {
  if (!projectId || !evidenceId || !userId || !controlId) {
    throw new Error('Explicit human evidence verification requires project, evidence, user and control identity.');
  }

  const row =
    await db.prepare(`
      SELECT *
      FROM control_evidence_items
      WHERE id=? AND project_id=? AND entry_id=?
    `).get(
      evidenceId,
      projectId,
      controlId
    );

  if (!row) {
    throw new Error('Manual evidence record was not found for explicit human verification.');
  }

  if (row.retention_status !== 'active') {
    throw new Error('Manual evidence must be active before explicit human verification.');
  }

  if (row.verification_state === 'verified') {
    return {
      evidenceId,
      verificationState: 'verified',
      alreadyVerified: true
    };
  }

  if (row.verification_state !== 'unverified') {
    throw new Error(
      `Manual evidence cannot be promoted from verification state ${row.verification_state}.`
    );
  }

  const previousDescriptor =
    JSON.parse(row.descriptor_json || '{}');

  if (
    intelligenceDigest(previousDescriptor) !==
    row.integrity_digest
  ) {
    throw new Error(
      'Manual evidence integrity verification failed before human trust promotion.'
    );
  }

  const timestamp = nowIso();

  const descriptor = {
    ...previousDescriptor,
    verificationState: 'verified',
    verificationScope
  };

  const nextDigest =
    intelligenceDigest(descriptor);

  const trust = {
    schema:
      'arl.control-evidence-trust-revision.v1',
    evidenceId,
    previousVerificationState: 'unverified',
    newVerificationState: 'verified',
    reason,
    controlId,
    actorId: userId,
    createdAt: timestamp
  };

  await db.transaction(async () => {
    const updated =
      await db.prepare(`
        UPDATE control_evidence_items
        SET verification_state='verified',
            descriptor_json=?,
            integrity_digest=?
        WHERE id=?
          AND project_id=?
          AND entry_id=?
          AND verification_state='unverified'
      `).run(
        JSON.stringify(descriptor),
        nextDigest,
        evidenceId,
        projectId,
        controlId
      );

    if (Number(updated.changes || 0) !== 1) {
      throw new Error(
        'Manual evidence verification conflict.'
      );
    }

    await db.prepare(`
      INSERT INTO control_evidence_trust_revisions
      (
        id,
        workspace_id,
        project_id,
        evidence_id,
        replacement_evidence_id,
        previous_verification_state,
        new_verification_state,
        reason,
        previous_descriptor_json,
        previous_integrity_digest,
        revision_digest,
        actor_id,
        created_at
      )
      VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
    `).run(
      id('ctr_'),
      row.workspace_id,
      projectId,
      evidenceId,
      'unverified',
      'verified',
      reason,
      row.descriptor_json,
      row.integrity_digest,
      intelligenceDigest(trust),
      userId,
      timestamp
    );
  });

  return {
    evidenceId,
    verificationState: 'verified',
    alreadyVerified: false,
    verificationScope,
    integrityDigest: nextDigest
  };
}
