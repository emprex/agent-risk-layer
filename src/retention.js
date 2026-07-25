import { config } from './config.js';
import { db, id, insertEvent, nowIso } from './db.js';

let timer = null;
let running = false;

export function enforceRetention({ now = new Date(), limit = 100 } = {}) {
  const nowValue = now.toISOString();
  const summary = { authorisationsExpired: 0, campaignsPurged: 0, recordsDeleted: 0, tokensDeleted: 0 };
  summary.authorisationsExpired = db.prepare(`UPDATE redteam_authorisations SET status='expired'
    WHERE status='active' AND window_end<?`).run(nowValue).changes;

  const groups = db.prepare(`SELECT r.authorisation_id, r.user_id, r.assessment_id, a.retention_days,
      MIN(r.retention_expires_at) AS deadline, COUNT(*) AS count
    FROM redteam_runs r JOIN redteam_authorisations a ON a.id=r.authorisation_id
    WHERE a.legal_hold=0 AND r.retention_expires_at IS NOT NULL AND r.retention_expires_at<=?
    GROUP BY r.authorisation_id,r.user_id,r.assessment_id,a.retention_days
    ORDER BY deadline ASC LIMIT ?`).all(nowValue, Math.max(1, Math.min(500, limit)));

  for (const group of groups) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const runs = db.prepare(`SELECT id,bundle_digest FROM redteam_runs
        WHERE authorisation_id=? AND retention_expires_at IS NOT NULL AND retention_expires_at<=?`).all(group.authorisation_id, nowValue);
      if (!runs.length) { db.exec('COMMIT'); continue; }
      const digests = runs.map((row) => row.bundle_digest);
      const deleted = db.prepare(`DELETE FROM redteam_runs WHERE authorisation_id=? AND retention_expires_at IS NOT NULL AND retention_expires_at<=?`)
        .run(group.authorisation_id, nowValue).changes;
      const tokensDeleted = db.prepare(`DELETE FROM redteam_tokens WHERE authorisation_id=? AND (used_at IS NOT NULL OR expires_at<=?)`)
        .run(group.authorisation_id, nowValue).changes;
      const receiptId = id('purge_');
      db.prepare(`INSERT INTO data_purge_receipts
        (id,user_id,assessment_id,authorisation_id,evidence_type,records_deleted,digests_json,reason,retention_deadline,executed_at)
        VALUES (?,?,?,?, 'redteam-evidence', ?, ?, 'customer-selected-retention-expired', ?, ?)`)
        .run(receiptId, group.user_id, group.assessment_id, group.authorisation_id, deleted, JSON.stringify(digests), group.deadline, nowValue);
      db.exec('COMMIT');
      insertEvent('redteam_evidence_purged', group.user_id, {
        receiptId, authorisationId: group.authorisation_id, assessmentId: group.assessment_id, recordsDeleted: deleted,
      });
      summary.campaignsPurged += 1;
      summary.recordsDeleted += deleted;
      summary.tokensDeleted += tokensDeleted;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  db.prepare('DELETE FROM redteam_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
  db.prepare('DELETE FROM inspection_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
  db.prepare('DELETE FROM email_verification_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
  db.prepare('DELETE FROM mfa_login_challenges WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
  return summary;
}

export function retentionOverview(userId = null) {
  const where = userId ? 'WHERE user_id=?' : '';
  const args = userId ? [userId] : [];
  return {
    expiringEvidence: db.prepare(`SELECT id,assessment_id,authorisation_id,retention_expires_at,created_at
      FROM redteam_runs ${where} ORDER BY retention_expires_at ASC LIMIT 100`).all(...args),
    purgeReceipts: db.prepare(`SELECT id,assessment_id,authorisation_id,evidence_type,records_deleted,reason,retention_deadline,executed_at
      FROM data_purge_receipts ${where} ORDER BY executed_at DESC LIMIT 100`).all(...args),
  };
}

export function startRetentionWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = true;
    try { enforceRetention(); }
    catch (error) { console.error('Retention worker failed:', error); }
    finally { running = false; }
  };
  run();
  timer = setInterval(run, config.retentionWorkerIntervalMs);
  timer.unref?.();
}
