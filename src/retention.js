import { config } from './config.js';
import { db, id, insertEvent, nowIso } from './db.js';
import { prepareRiskKnowledgeRuntimeEvidencePurge } from './risk-knowledge.js';
let timer = null;
let running = false;
export async function enforceRetention({ now = new Date(), limit = 100 } = {}) {
    const nowValue = now.toISOString();
    const summary = { authorisationsExpired: 0, campaignsPurged: 0, recordsDeleted: 0, tokensDeleted: 0, runtimeEventsPurged: 0 };
    summary.authorisationsExpired = (await db.prepare(`UPDATE redteam_authorisations SET status='expired'
    WHERE status='active' AND window_end<?`).run(nowValue)).changes;
    const groups = await db.prepare(`SELECT r.authorisation_id, r.user_id, r.assessment_id, a.retention_days,
      MIN(r.retention_expires_at) AS deadline, COUNT(*) AS count
    FROM redteam_runs r JOIN redteam_authorisations a ON a.id=r.authorisation_id
    WHERE a.legal_hold=0 AND r.retention_expires_at IS NOT NULL AND r.retention_expires_at<=?
    GROUP BY r.authorisation_id,r.user_id,r.assessment_id,a.retention_days
    ORDER BY deadline ASC LIMIT ?`).all(nowValue, Math.max(1, Math.min(500, limit)));
    for (const group of groups) {
        const purge = await db.transaction(async () => {
            const runs = await db.prepare(`SELECT id,bundle_digest FROM redteam_runs
        WHERE authorisation_id=? AND retention_expires_at IS NOT NULL AND retention_expires_at<=?`).all(group.authorisation_id, nowValue);
            if (!runs.length)
                return null;
            const digests = runs.map((row) => row.bundle_digest);
            const deleted = (await db.prepare(`DELETE FROM redteam_runs WHERE authorisation_id=? AND retention_expires_at IS NOT NULL AND retention_expires_at<=?`)
                .run(group.authorisation_id, nowValue)).changes;
            const tokensDeleted = (await db.prepare(`DELETE FROM redteam_tokens WHERE authorisation_id=? AND (used_at IS NOT NULL OR expires_at<=?)`)
                .run(group.authorisation_id, nowValue)).changes;
            const receiptId = id('purge_');
            await db.prepare(`INSERT INTO data_purge_receipts
        (id,user_id,assessment_id,authorisation_id,evidence_type,records_deleted,digests_json,reason,retention_deadline,executed_at)
        VALUES (?,?,?,?, 'redteam-evidence', ?, ?, 'customer-selected-retention-expired', ?, ?)`)
                .run(receiptId, group.user_id, group.assessment_id, group.authorisation_id, deleted, JSON.stringify(digests), group.deadline, nowValue);
            return { receiptId, deleted, tokensDeleted };
        });
        if (!purge)
            continue;
        await insertEvent('redteam_evidence_purged', group.user_id, {
            receiptId: purge.receiptId, authorisationId: group.authorisation_id, assessmentId: group.assessment_id, recordsDeleted: purge.deleted,
        });
        summary.campaignsPurged += 1;
        summary.recordsDeleted += purge.deleted;
        summary.tokensDeleted += purge.tokensDeleted;
    }
    await db.prepare('DELETE FROM redteam_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
    await db.prepare('DELETE FROM inspection_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
    await db.prepare('DELETE FROM email_verification_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
    await db.prepare('DELETE FROM mfa_login_challenges WHERE expires_at<=? OR used_at IS NOT NULL').run(nowValue);
    const projects = await db.prepare(`SELECT id,retention_days FROM security_projects WHERE status!='archived'`).all();
    for (const project of projects) {
        const cutoff = new Date(now.getTime() - Math.max(1, Number(project.retention_days || 30)) * 86400000).toISOString();
        await db.transaction(async () => {
            const events = await db.prepare('SELECT id FROM runtime_events WHERE project_id=? AND created_at<?').all(project.id, cutoff);
            await prepareRiskKnowledgeRuntimeEvidencePurge({ projectId: project.id, eventIds: events.map((row) => row.id),
                reason: 'runtime event retention expired', timestamp: nowValue });
            summary.runtimeEventsPurged += Number((await db.prepare('DELETE FROM runtime_events WHERE project_id=? AND created_at<?').run(project.id, cutoff)).changes || 0);
        });
    }
    return summary;
}
export async function retentionOverview(userId = null) {
    const where = userId ? 'WHERE user_id=?' : '';
    const args = userId ? [userId] : [];
    return {
        expiringEvidence: await db.prepare(`SELECT id,assessment_id,authorisation_id,retention_expires_at,created_at
      FROM redteam_runs ${where} ORDER BY retention_expires_at ASC LIMIT 100`).all(...args),
        purgeReceipts: await db.prepare(`SELECT id,assessment_id,authorisation_id,evidence_type,records_deleted,reason,retention_deadline,executed_at
      FROM data_purge_receipts ${where} ORDER BY executed_at DESC LIMIT 100`).all(...args),
    };
}
export async function startRetentionWorker() {
    if (timer)
        return;
    const run = async () => {
        if (running)
            return;
        running = true;
        try {
            await enforceRetention();
        }
        catch (error) {
            console.error('Retention worker failed:', error);
        }
        finally {
            running = false;
        }
    };
    await run();
    timer = setInterval(run, config.retentionWorkerIntervalMs);
    timer.unref?.();
}
