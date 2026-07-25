import crypto from 'node:crypto';
import { config, plans } from './config.js';
import { db, id, insertEvent, nowIso } from './db.js';
import { buildAssessmentReport } from './report-service.js';
import { renderReportPdf } from './pdf.js';
import { sendOperationalAlert, sendReportEmail, sendWelcomeEmail } from './email.js';

const MAX_JOB_ATTEMPTS = 8;
let workerTimer = null;
let workerRunning = false;

export async function fulfilCheckout(session, { processEmailNow = true } = {}) {
  const metadata = session?.metadata || {};
  const userId = String(metadata.user_id || '');
  const productKey = String(metadata.product_key || '');
  const assessmentId = String(metadata.assessment_id || '') || null;
  const plan = plans[productKey];
  if (!session?.id || !userId || !plan) throw new Error('Checkout metadata is incomplete.');
  const user = db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);
  if (!user) throw new Error('Checkout user not found.');

  const purchase = upsertPurchase(session, { userId, assessmentId, productKey, plan });
  if (purchase.fulfilment_state !== 'fulfilled') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE purchases SET fulfilment_state='processing', fulfilment_attempts=fulfilment_attempts+1,
        fulfilment_error=NULL, updated_at=? WHERE id=?`).run(nowIso(), purchase.id);
      if (plan.recurring) grantSubscription({ session, userId, productKey });
      else grantReportAccess({ userId, assessmentId, plan });
      enqueueDeliveryJob({ purchaseId: purchase.id, jobType: plan.recurring ? 'welcome_email' : 'report_email' });
      db.prepare(`UPDATE purchases SET fulfilment_state='fulfilled', access_granted_at=COALESCE(access_granted_at,?),
        fulfilled_at=COALESCE(fulfilled_at,?), updated_at=? WHERE id=?`)
        .run(nowIso(), nowIso(), nowIso(), purchase.id);
      db.exec('COMMIT');
      insertEvent(plan.recurring ? 'subscription_started' : 'report_purchased', userId, {
        assessmentId, productKey, purchaseId: purchase.id, tier: plan.reportTier || null,
      });
    } catch (error) {
      db.exec('ROLLBACK');
      db.prepare(`UPDATE purchases SET fulfilment_state='failed',fulfilment_error=?,updated_at=? WHERE id=?`)
        .run(truncateError(error), nowIso(), purchase.id);
      createAlert('critical', 'payment_fulfilment', `Paid checkout ${session.id} failed before access was granted: ${error.message}`, 'purchase', purchase.id);
      throw error;
    }
  }

  if (processEmailNow) await processPurchaseJobs(purchase.id).catch(() => null);
  return db.prepare('SELECT * FROM purchases WHERE id=?').get(purchase.id);
}

export async function reconcileIncompletePurchases({ limit = 25 } = {}) {
  const rows = db.prepare(`SELECT * FROM purchases WHERE status='paid' AND fulfilment_state!='fulfilled'
    ORDER BY updated_at ASC LIMIT ?`).all(Math.max(1, Math.min(200, limit)));
  const result = { examined: rows.length, fulfilled: 0, failed: 0 };
  for (const row of rows) {
    try {
      const session = parse(row.session_json, null);
      if (!session?.id) throw new Error('Stored checkout session is unavailable.');
      await fulfilCheckout(session, { processEmailNow: false });
      result.fulfilled += 1;
    } catch (error) {
      result.failed += 1;
      db.prepare('UPDATE purchases SET fulfilment_error=?,updated_at=? WHERE id=?').run(truncateError(error), nowIso(), row.id);
    }
  }
  return result;
}

export async function processDueFulfilmentJobs({ limit = 10 } = {}) {
  // Recover jobs interrupted by a process restart.
  db.prepare(`UPDATE fulfilment_jobs SET status='queued',updated_at=?
    WHERE status='processing' AND updated_at<?`).run(nowIso(), new Date(Date.now() - 10 * 60_000).toISOString());
  const jobs = db.prepare(`SELECT id FROM fulfilment_jobs
    WHERE status IN ('queued','failed') AND attempts < ? AND next_attempt_at <= ?
    ORDER BY next_attempt_at ASC LIMIT ?`).all(MAX_JOB_ATTEMPTS, nowIso(), Math.max(1, Math.min(100, limit)));
  const summary = { examined: jobs.length, completed: 0, failed: 0 };
  for (const job of jobs) {
    const outcome = await processFulfilmentJob(job.id);
    summary[outcome ? 'completed' : 'failed'] += 1;
  }
  return summary;
}

export async function processPurchaseJobs(purchaseId) {
  const jobs = db.prepare(`SELECT id FROM fulfilment_jobs WHERE purchase_id=? AND status!='completed' ORDER BY created_at`).all(purchaseId);
  for (const job of jobs) await processFulfilmentJob(job.id);
}

export async function processFulfilmentJob(jobId, dependencies = {}) {
  const claimedAt = nowIso();
  const claimed = db.prepare(`UPDATE fulfilment_jobs SET status='processing',attempts=attempts+1,updated_at=?
    WHERE id=? AND status IN ('queued','failed') AND next_attempt_at<=? AND attempts<?`)
    .run(claimedAt, jobId, claimedAt, MAX_JOB_ATTEMPTS);
  if (claimed.changes !== 1) return false;
  const job = db.prepare(`SELECT j.*,p.user_id,p.assessment_id,p.product_key,p.report_snapshot_json,p.report_digest,
    u.email,a.name AS assessment_name FROM fulfilment_jobs j
    JOIN purchases p ON p.id=j.purchase_id
    LEFT JOIN users u ON u.id=p.user_id
    LEFT JOIN assessments a ON a.id=p.assessment_id
    WHERE j.id=?`).get(jobId);
  try {
    if (!job?.email) throw new Error('Delivery recipient is unavailable.');
    let providerResult;
    if (job.job_type === 'welcome_email') {
      const plan = plans[job.product_key];
      providerResult = await (dependencies.sendWelcome || sendWelcomeEmail)({ userId: job.user_id, to: job.email, planName: plan?.name || 'subscription' });
    } else if (job.job_type === 'report_email') {
      let report;
      let digest = job.report_digest;
      if (job.report_snapshot_json) report = JSON.parse(job.report_snapshot_json);
      else {
        const built = buildAssessmentReport(job.assessment_id, plans[job.product_key]?.reportTier || 'pro');
        report = built.report;
        const snapshotJson = JSON.stringify(report);
        digest = crypto.createHash('sha256').update(snapshotJson).digest('hex');
        db.prepare('UPDATE purchases SET report_snapshot_json=?,report_digest=?,updated_at=? WHERE id=?')
          .run(snapshotJson, digest, nowIso(), job.purchase_id);
      }
      const pdf = await (dependencies.renderPdf || renderReportPdf)(report);
      providerResult = await (dependencies.sendReport || sendReportEmail)({
        userId: job.user_id,
        to: job.email,
        assessmentName: job.assessment_name || 'AI agent assessment',
        pdfBuffer: pdf,
        filename: `${safeFilename(job.assessment_name || 'agent-risk')}-agent-risk-report.pdf`,
      });
      const actualDigest = crypto.createHash('sha256').update(job.report_snapshot_json || JSON.stringify(report)).digest('hex');
      if (digest && actualDigest !== digest) throw new Error('Stored report snapshot failed its integrity check.');
    } else throw new Error(`Unsupported fulfilment job: ${job.job_type}`);

    const state = providerResult?.simulated ? 'simulated' : 'sent';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE fulfilment_jobs SET status='completed',last_error=NULL,completed_at=?,updated_at=? WHERE id=?`)
        .run(nowIso(), nowIso(), job.id);
      db.prepare(`UPDATE purchases SET email_state=?,email_attempts=email_attempts+1,email_error=NULL,email_sent_at=?,updated_at=? WHERE id=?`)
        .run(state, nowIso(), nowIso(), job.purchase_id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return true;
  } catch (error) {
    const attempts = Number(job.attempts || 0);
    const exhausted = attempts >= MAX_JOB_ATTEMPTS;
    const delay = Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(8, Math.max(0, attempts - 1))));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE fulfilment_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?`)
        .run(exhausted ? 'dead' : 'failed', truncateError(error), new Date(Date.now() + delay).toISOString(), nowIso(), job.id);
      db.prepare(`UPDATE purchases SET email_state=?,email_attempts=email_attempts+1,email_error=?,updated_at=? WHERE id=?`)
        .run(exhausted ? 'dead' : 'retrying', truncateError(error), nowIso(), job.purchase_id);
      db.exec('COMMIT');
    } catch (updateError) { db.exec('ROLLBACK'); console.error(updateError); }
    if (exhausted) {
      createAlert('high', 'email_delivery', `Delivery job ${job.id} exhausted retries: ${error.message}`, 'purchase', job.purchase_id);
      if (config.adminEmail) {
        await sendOperationalAlert({
          to: config.adminEmail,
          subject: 'AgentRiskLayer delivery requires attention',
          message: `Purchase ${job.purchase_id} has access granted but delivery failed after ${MAX_JOB_ATTEMPTS} attempts.`,
        }).catch(() => null);
      }
    }
    return false;
  }
}

export function fulfilmentOperations() {
  return {
    incompletePurchases: db.prepare(`SELECT id,user_id,assessment_id,product_key,stripe_session_id,fulfilment_state,
      fulfilment_attempts,fulfilment_error,email_state,email_attempts,email_error,updated_at
      FROM purchases WHERE fulfilment_state!='fulfilled' OR email_state IN ('retrying','dead') ORDER BY updated_at DESC LIMIT 100`).all(),
    queuedJobs: db.prepare(`SELECT id,purchase_id,job_type,status,attempts,next_attempt_at,last_error,updated_at
      FROM fulfilment_jobs WHERE status!='completed' ORDER BY updated_at DESC LIMIT 100`).all(),
    openAlerts: db.prepare(`SELECT * FROM operational_alerts WHERE status='open' ORDER BY created_at DESC LIMIT 100`).all(),
  };
}

export function resolveOperationalAlert(alertId) {
  return db.prepare(`UPDATE operational_alerts SET status='resolved',resolved_at=? WHERE id=? AND status='open'`)
    .run(nowIso(), alertId).changes === 1;
}

export function startFulfilmentWorker() {
  if (workerTimer) return;
  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await reconcileIncompletePurchases();
      await processDueFulfilmentJobs();
    } catch (error) { console.error('Fulfilment worker failed:', error); }
    finally { workerRunning = false; }
  };
  run();
  workerTimer = setInterval(run, config.fulfilmentWorkerIntervalMs);
  workerTimer.unref?.();
}

function upsertPurchase(session, { userId, assessmentId, productKey, plan }) {
  const created = nowIso();
  const amountPence = Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : plan.amountPence;
  const currency = String(session.currency || 'gbp').slice(0, 8).toLowerCase();
  const sessionJson = JSON.stringify(sanitiseSession(session));
  db.prepare(`INSERT INTO purchases
    (id,user_id,assessment_id,product_key,amount_pence,currency,status,stripe_session_id,stripe_customer_id,
     fulfilment_state,email_state,session_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'paid',?,?, 'received','pending',?,?,?)
    ON CONFLICT(stripe_session_id) DO UPDATE SET status='paid',session_json=excluded.session_json,
      stripe_customer_id=excluded.stripe_customer_id,amount_pence=excluded.amount_pence,currency=excluded.currency,updated_at=excluded.updated_at`)
    .run(id('pay_'), userId, assessmentId, productKey, amountPence, currency, session.id, String(session.customer || ''), sessionJson, created, created);
  return db.prepare('SELECT * FROM purchases WHERE stripe_session_id=?').get(session.id);
}

function grantSubscription({ session, userId, productKey }) {
  const subscriptionId = String(session.subscription || id('sub_'));
  const at = nowIso();
  db.prepare(`INSERT INTO subscriptions
    (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,current_period_end,created_at,updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET status='active',plan_key=excluded.plan_key,
      stripe_customer_id=excluded.stripe_customer_id,updated_at=excluded.updated_at`)
    .run(id('subrec_'), userId, productKey, String(session.customer || ''), subscriptionId,
      new Date(Date.now() + 31 * 86400000).toISOString(), at, at);
}

function grantReportAccess({ userId, assessmentId, plan }) {
  const assessment = db.prepare('SELECT id,paid_tier FROM assessments WHERE id=? AND user_id=?').get(assessmentId, userId);
  if (!assessment) throw new Error('Assessment for report fulfilment not found.');
  const nextTier = assessment.paid_tier === 'pro' || plan.reportTier === 'pro' ? 'pro' : 'basic';
  db.prepare('UPDATE assessments SET paid_tier=?,updated_at=? WHERE id=?').run(nextTier, nowIso(), assessment.id);
}

function enqueueDeliveryJob({ purchaseId, jobType }) {
  const at = nowIso();
  db.prepare(`INSERT INTO fulfilment_jobs (id,purchase_id,job_type,status,attempts,next_attempt_at,last_error,payload_json,created_at,updated_at)
    VALUES (?, ?, ?, 'queued', 0, ?, NULL, '{}', ?, ?)
    ON CONFLICT(purchase_id,job_type) DO NOTHING`)
    .run(id('job_'), purchaseId, jobType, at, at, at);
}

function sanitiseSession(session) {
  return {
    id: String(session.id || ''), mode: String(session.mode || ''), payment_status: String(session.payment_status || ''),
    amount_total: Number(session.amount_total || 0), currency: String(session.currency || 'gbp'),
    customer: String(session.customer || ''), subscription: String(session.subscription || ''),
    metadata: {
      user_id: String(session.metadata?.user_id || ''), assessment_id: String(session.metadata?.assessment_id || ''),
      product_key: String(session.metadata?.product_key || ''),
    },
  };
}

function createAlert(severity, category, message, resourceType, resourceId) {
  const existing = db.prepare(`SELECT id FROM operational_alerts WHERE status='open' AND category=? AND resource_type=? AND resource_id=?`).get(category, resourceType, resourceId);
  if (existing) return existing.id;
  const alertId = id('alert_');
  db.prepare(`INSERT INTO operational_alerts (id,severity,category,message,resource_type,resource_id,status,created_at)
    VALUES (?,?,?,?,?,?,'open',?)`).run(alertId, severity, category, String(message).slice(0, 1200), resourceType, resourceId, nowIso());
  return alertId;
}

function parse(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function truncateError(error) { return String(error?.message || error || 'Unknown failure').slice(0, 1200); }
function safeFilename(value) { return String(value || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'report'; }
