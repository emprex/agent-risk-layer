import crypto from 'node:crypto';
import { config, plans } from './config.js';
import { db, id, insertEvent, nowIso } from './db.js';
import { buildAssessmentReport } from './report-service.js';
import { renderReportPdf } from './pdf.js';
import { sendOperationalAlert, sendReportEmail, sendWelcomeEmail } from './email.js';
const MAX_JOB_ATTEMPTS = 8;
let workerTimer = null;
let workerRunning = false;

export async function createPendingCheckout({
    userId, assessmentId = null, projectId = null, productKey, stripePriceId,
    expectedAmountPence, expectedCurrency = 'gbp', checkoutMode, expectedCustomerEmail,
    expiresAt,
}) {
    const plan = plans[productKey];
    if (!plan || !stripePriceId || !['payment', 'subscription'].includes(checkoutMode))
        throw new Error('Pending Checkout binding is incomplete.');
    if ((plan.recurring ? 'subscription' : 'payment') !== checkoutMode)
        throw new Error('Checkout mode does not match the product catalogue.');
    const amount = Number(expectedAmountPence);
    const currency = String(expectedCurrency || '').toLowerCase();
    if (!Number.isInteger(amount) || amount < 0 || !/^[a-z]{3}$/.test(currency))
        throw new Error('Expected Checkout amount or currency is invalid.');
    const user = await db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);
    if (!user || user.email.toLowerCase() !== String(expectedCustomerEmail || '').toLowerCase())
        throw new Error('Pending Checkout user identity is invalid.');
    if (assessmentId && !await db.prepare('SELECT id FROM assessments WHERE id=? AND user_id=?').get(assessmentId, userId))
        throw new Error('Pending Checkout assessment does not belong to the authenticated user.');
    if (projectId && !await db.prepare('SELECT id FROM security_projects WHERE id=? AND billing_user_id=?').get(projectId, userId))
        throw new Error('Pending Checkout project does not belong to the authenticated billing user.');
    const created = nowIso();
    const expiry = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.parse(created))
        throw new Error('Pending Checkout expiry is invalid.');
    const purchaseId = id('pay_');
    await db.prepare(`INSERT INTO purchases
      (id,user_id,assessment_id,project_id,product_key,amount_pence,currency,status,stripe_session_id,stripe_customer_id,
       fulfilment_state,email_state,session_json,stripe_price_id,expected_amount_pence,expected_currency,checkout_mode,
       expected_customer_email,binding_state,binding_expires_at,checkout_created_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'pending',NULL,NULL,'pending','pending','{}',?,?,?,?,?,'pending_creation',?,?,?,?)`)
        .run(purchaseId, userId, assessmentId, projectId, productKey, amount, currency, stripePriceId, amount, currency,
            checkoutMode, user.email.toLowerCase(), expiry, created, created, created);
    return db.prepare('SELECT * FROM purchases WHERE id=?').get(purchaseId);
}

export async function bindPendingCheckoutSession(purchaseId, session) {
    if (!session?.id) throw new Error('Stripe Checkout session ID is missing.');
    return db.transaction(async () => {
        const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
        const purchase = await db.prepare(`SELECT * FROM purchases WHERE id=?${lock}`).get(purchaseId);
        if (!purchase || purchase.binding_state !== 'pending_creation' || purchase.stripe_session_id)
            throw new Error('Pending Checkout cannot be rebound.');
        if (session.mode !== purchase.checkout_mode || session.metadata?.purchase_id !== purchase.id)
            throw new Error('Created Stripe Checkout session does not match the pending purchase.');
        const result = await db.prepare(`UPDATE purchases SET stripe_session_id=?,stripe_customer_id=?,
          binding_state='pending',binding_expires_at=?,session_json=?,updated_at=?
          WHERE id=? AND binding_state='pending_creation' AND stripe_session_id IS NULL`).run(
            String(session.id), String(session.customer || '') || null,
            session.expires_at ? new Date(Number(session.expires_at) * 1000).toISOString() : purchase.binding_expires_at,
            JSON.stringify(sanitiseSession(session)), nowIso(), purchase.id);
        if (Number(result.changes) !== 1) throw new Error('Pending Checkout session binding raced with another request.');
        return db.prepare('SELECT * FROM purchases WHERE id=?').get(purchase.id);
    });
}

export async function failPendingCheckoutCreation(purchaseId, error) {
    await db.prepare(`UPDATE purchases SET binding_state='creation_failed',fulfilment_state='failed',
      fulfilment_error=?,updated_at=? WHERE id=? AND binding_state='pending_creation'`)
        .run(truncateError(error), nowIso(), purchaseId);
}

export async function fulfilCheckout(session, { processEmailNow = true } = {}) {
    const metadata = session?.metadata || {};
    const purchaseId = String(metadata.purchase_id || '');
    if (!session?.id || !purchaseId) throw integrityError('Stripe Checkout is not bound to a pending purchase.');
    let purchase;
    try {
        purchase = await db.transaction(async () => {
            const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
            const pending = await db.prepare(`SELECT * FROM purchases WHERE id=?${lock}`).get(purchaseId);
            if (!pending) throw integrityError('Pending purchase is missing.');
            if (pending.fulfilment_state === 'fulfilled' && pending.binding_state === 'verified') {
                verifyCheckoutBinding(pending, session, { completed: true });
                return pending;
            }
            const plan = verifyCheckoutBinding(pending, session);
            const userId = pending.user_id;
            const assessmentId = pending.assessment_id;
            await db.prepare(`UPDATE purchases SET binding_state='verified',binding_verified_at=?,
              stripe_customer_id=?,status='paid',fulfilment_state='processing',
              fulfilment_attempts=fulfilment_attempts+1,fulfilment_error=NULL,session_json=?,updated_at=?
              WHERE id=?`).run(nowIso(), String(session.customer), JSON.stringify(sanitiseSession(session)), nowIso(), pending.id);
                if (plan.recurring)
                    await createPendingSubscriptionBinding({ session, userId, productKey: pending.product_key, purchaseId: pending.id });
                else
                    await grantReportAccess({ userId, assessmentId, plan });
                await enqueueDeliveryJob({ purchaseId: pending.id, jobType: plan.recurring ? 'welcome_email' : 'report_email' });
                await db.prepare(`UPDATE purchases SET fulfilment_state='fulfilled', access_granted_at=COALESCE(access_granted_at,?),
        fulfilled_at=COALESCE(fulfilled_at,?), updated_at=? WHERE id=?`)
                    .run(nowIso(), nowIso(), nowIso(), pending.id);
                await insertEvent(plan.recurring ? 'subscription_checkout_bound' : 'report_purchased', userId, {
                    assessmentId, productKey: pending.product_key, purchaseId: pending.id, tier: plan.reportTier || null,
                });
            return db.prepare('SELECT * FROM purchases WHERE id=?').get(pending.id);
            });
    }
    catch (error) {
        if (purchaseId) {
            await db.prepare(`UPDATE purchases SET binding_state=?,quarantined_at=CASE WHEN ?='quarantined' THEN ? ELSE quarantined_at END,
              fulfilment_state='failed',fulfilment_error=?,updated_at=? WHERE id=? AND fulfilment_state!='fulfilled'`).run(
                error.code === 'billing_integrity' ? 'quarantined' : 'pending', error.code === 'billing_integrity' ? 'quarantined' : 'pending',
                nowIso(), truncateError(error), nowIso(), purchaseId);
            await createAlert('critical', 'payment_fulfilment', `Checkout ${String(session.id).slice(0, 120)} failed before access was granted: ${error.message}`, 'purchase', purchaseId);
        }
        throw error;
    }
    if (processEmailNow)
        await processPurchaseJobs(purchase.id).catch(() => null);
    return await db.prepare('SELECT * FROM purchases WHERE id=?').get(purchase.id);
}
export async function reconcileIncompletePurchases({ limit = 25 } = {}) {
    const rows = await db.prepare(`SELECT * FROM purchases WHERE status='paid' AND fulfilment_state!='fulfilled'
      AND binding_state IN ('pending','verified')
    ORDER BY updated_at ASC LIMIT ?`).all(Math.max(1, Math.min(200, limit)));
    const result = { examined: rows.length, fulfilled: 0, failed: 0 };
    for (const row of rows) {
        try {
            const session = parse(row.session_json, null);
            if (!session?.id)
                throw new Error('Stored checkout session is unavailable.');
            await fulfilCheckout(session, { processEmailNow: false });
            result.fulfilled += 1;
        }
        catch (error) {
            result.failed += 1;
            await db.prepare('UPDATE purchases SET fulfilment_error=?,updated_at=? WHERE id=?').run(truncateError(error), nowIso(), row.id);
        }
    }
    return result;
}
export async function processDueFulfilmentJobs({ limit = 10 } = {}) {
    // Recover jobs interrupted by a process restart.
    await db.prepare(`UPDATE fulfilment_jobs SET status='queued',updated_at=?
    WHERE status='processing' AND updated_at<?`).run(nowIso(), new Date(Date.now() - 10 * 60000).toISOString());
    const jobs = await db.prepare(`SELECT id FROM fulfilment_jobs
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
    const jobs = await db.prepare(`SELECT id FROM fulfilment_jobs WHERE purchase_id=? AND status!='completed' ORDER BY created_at`).all(purchaseId);
    for (const job of jobs)
        await processFulfilmentJob(job.id);
}
export async function processFulfilmentJob(jobId, dependencies = {}) {
    const claimedAt = nowIso();
    const claimed = await db.prepare(`UPDATE fulfilment_jobs SET status='processing',attempts=attempts+1,updated_at=?
    WHERE id=? AND status IN ('queued','failed') AND next_attempt_at<=? AND attempts<?`)
        .run(claimedAt, jobId, claimedAt, MAX_JOB_ATTEMPTS);
    if (claimed.changes !== 1)
        return false;
    const job = await db.prepare(`SELECT j.*,p.user_id,p.assessment_id,p.product_key,p.report_snapshot_json,p.report_digest,
    u.email,a.name AS assessment_name FROM fulfilment_jobs j
    JOIN purchases p ON p.id=j.purchase_id
    LEFT JOIN users u ON u.id=p.user_id
    LEFT JOIN assessments a ON a.id=p.assessment_id
    WHERE j.id=?`).get(jobId);
    try {
        if (!job?.email)
            throw new Error('Delivery recipient is unavailable.');
        let providerResult;
        if (job.job_type === 'welcome_email') {
            const plan = plans[job.product_key];
            providerResult = await (dependencies.sendWelcome || sendWelcomeEmail)({ userId: job.user_id, to: job.email, planName: plan?.name || 'subscription' });
        }
        else if (job.job_type === 'report_email') {
            let report;
            let digest = job.report_digest;
            if (job.report_snapshot_json)
                report = JSON.parse(job.report_snapshot_json);
            else {
                const built = await buildAssessmentReport(job.assessment_id, plans[job.product_key]?.reportTier || 'pro');
                report = built.report;
                const snapshotJson = JSON.stringify(report);
                digest = crypto.createHash('sha256').update(snapshotJson).digest('hex');
                await db.prepare('UPDATE purchases SET report_snapshot_json=?,report_digest=?,updated_at=? WHERE id=?')
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
            if (digest && actualDigest !== digest)
                throw new Error('Stored report snapshot failed its integrity check.');
        }
        else
            throw new Error(`Unsupported fulfilment job: ${job.job_type}`);
        const state = providerResult?.simulated ? 'simulated' : 'sent';
        await db.transaction(async () => {
            await db.prepare(`UPDATE fulfilment_jobs SET status='completed',last_error=NULL,completed_at=?,updated_at=? WHERE id=?`)
                .run(nowIso(), nowIso(), job.id);
            await db.prepare(`UPDATE purchases SET email_state=?,email_attempts=email_attempts+1,email_error=NULL,email_sent_at=?,updated_at=? WHERE id=?`)
                .run(state, nowIso(), nowIso(), job.purchase_id);
        });
        return true;
    }
    catch (error) {
        const attempts = Number(job.attempts || 0);
        const exhausted = attempts >= MAX_JOB_ATTEMPTS;
        const delay = Math.min(6 * 60 * 60000, 30000 * (2 ** Math.min(8, Math.max(0, attempts - 1))));
        try {
            await db.transaction(async () => {
                await db.prepare(`UPDATE fulfilment_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?`)
                    .run(exhausted ? 'dead' : 'failed', truncateError(error), new Date(Date.now() + delay).toISOString(), nowIso(), job.id);
                await db.prepare(`UPDATE purchases SET email_state=?,email_attempts=email_attempts+1,email_error=?,updated_at=? WHERE id=?`)
                    .run(exhausted ? 'dead' : 'retrying', truncateError(error), nowIso(), job.purchase_id);
            });
        }
        catch (updateError) {
            console.error(updateError);
        }
        if (exhausted) {
            await createAlert('high', 'email_delivery', `Delivery job ${job.id} exhausted retries: ${error.message}`, 'purchase', job.purchase_id);
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
export async function fulfilmentOperations() {
    return {
        incompletePurchases: await db.prepare(`SELECT id,user_id,assessment_id,product_key,stripe_session_id,fulfilment_state,
      fulfilment_attempts,fulfilment_error,email_state,email_attempts,email_error,updated_at
      FROM purchases WHERE fulfilment_state!='fulfilled' OR email_state IN ('retrying','dead') ORDER BY updated_at DESC LIMIT 100`).all(),
        queuedJobs: await db.prepare(`SELECT id,purchase_id,job_type,status,attempts,next_attempt_at,last_error,updated_at
      FROM fulfilment_jobs WHERE status!='completed' ORDER BY updated_at DESC LIMIT 100`).all(),
        openAlerts: await db.prepare(`SELECT * FROM operational_alerts WHERE status='open' ORDER BY created_at DESC LIMIT 100`).all(),
    };
}
export async function resolveOperationalAlert(alertId) {
    return (await db.prepare(`UPDATE operational_alerts SET status='resolved',resolved_at=? WHERE id=? AND status='open'`)
        .run(nowIso(), alertId)).changes === 1;
}
export async function startFulfilmentWorker() {
    if (workerTimer)
        return;
    const run = async () => {
        if (workerRunning)
            return;
        workerRunning = true;
        try {
            await reconcileIncompletePurchases();
            await processDueFulfilmentJobs();
        }
        catch (error) {
            console.error('Fulfilment worker failed:', error);
        }
        finally {
            workerRunning = false;
        }
    };
    await run();
    workerTimer = setInterval(run, config.fulfilmentWorkerIntervalMs);
    workerTimer.unref?.();
}
function verifyCheckoutBinding(purchase, session, { completed = false } = {}) {
    const plan = plans[purchase.product_key];
    const cataloguePrice = config.demoMode ? `demo_price_${purchase.product_key}` : config.stripePrices[purchase.product_key];
    const sessionEmail = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
    const checks = [
        [plan, 'Stored product is not in the server catalogue.'],
        [completed ? purchase.binding_state === 'verified' : purchase.binding_state === 'pending', 'Pending purchase is not active.'],
        [completed || Date.parse(purchase.binding_expires_at || '') > Date.now(), 'Pending purchase is expired.'],
        [String(session.id) === purchase.stripe_session_id, 'Checkout session ID does not match.'],
        [String(session.metadata?.purchase_id || '') === purchase.id, 'Checkout purchase identity does not match.'],
        [String(session.metadata?.user_id || '') === purchase.user_id && String(session.client_reference_id || '') === purchase.user_id,
            'Checkout user identity does not match.'],
        [String(session.metadata?.product_key || '') === purchase.product_key, 'Checkout product does not match.'],
        [Boolean(cataloguePrice) && purchase.stripe_price_id === cataloguePrice, 'Stored Checkout price is not current in the server catalogue.'],
        [String(session.metadata?.price_id || '') === purchase.stripe_price_id, 'Checkout price does not match.'],
        [String(session.metadata?.assessment_id || '') === String(purchase.assessment_id || ''), 'Checkout assessment does not match.'],
        [String(session.metadata?.project_id || '') === String(purchase.project_id || ''), 'Checkout project does not match.'],
        [session.mode === purchase.checkout_mode && session.mode === (plan?.recurring ? 'subscription' : 'payment'), 'Checkout mode does not match.'],
        [Number(session.amount_total) === Number(purchase.expected_amount_pence)
            && Number(purchase.amount_pence) === Number(purchase.expected_amount_pence), 'Checkout amount does not match.'],
        [String(session.currency || '').toLowerCase() === purchase.expected_currency
            && purchase.currency === purchase.expected_currency, 'Checkout currency does not match.'],
        [session.payment_status === 'paid', 'Checkout payment is not paid.'],
        [Boolean(String(session.customer || '')), 'Stripe customer identity is missing.'],
        [!purchase.stripe_customer_id || String(session.customer) === purchase.stripe_customer_id, 'Stripe customer identity does not match.'],
        [sessionEmail && sessionEmail === purchase.expected_customer_email, 'Checkout customer email does not match.'],
    ];
    for (const [valid, message] of checks) if (!valid) throw integrityError(message);
    return plan;
}
async function createPendingSubscriptionBinding({ session, userId, productKey, purchaseId }) {
    const subscriptionId = String(session.subscription || '');
    if (!subscriptionId)
        throw integrityError('Authoritative Stripe subscription identity is missing.');
    const at = nowIso();
    await db.prepare(`INSERT INTO subscriptions
    (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,purchase_id,current_period_start,current_period_end,
     cancel_at_period_end,canceled_at,authoritative_state,billing_state_source,created_at,updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 0, NULL, 0, 'pending_checkout', ?, ?)
    ON CONFLICT(stripe_subscription_id) DO NOTHING`)
        .run(id('subrec_'), userId, productKey, String(session.customer || ''), subscriptionId, purchaseId, at, at);
    const binding = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(subscriptionId);
    if (!binding || binding.user_id !== userId || binding.plan_key !== productKey
        || binding.purchase_id !== purchaseId || String(binding.stripe_customer_id || '') !== String(session.customer || ''))
        throw integrityError('Stripe subscription is already bound to a different purchase or account.');
}
async function grantReportAccess({ userId, assessmentId, plan }) {
    const assessment = await db.prepare('SELECT id,paid_tier FROM assessments WHERE id=? AND user_id=?').get(assessmentId, userId);
    if (!assessment)
        throw new Error('Assessment for report fulfilment not found.');
    const nextTier = assessment.paid_tier === 'pro' || plan.reportTier === 'pro' ? 'pro' : 'basic';
    await db.prepare('UPDATE assessments SET paid_tier=?,updated_at=? WHERE id=?').run(nextTier, nowIso(), assessment.id);
}
async function enqueueDeliveryJob({ purchaseId, jobType }) {
    const at = nowIso();
    await db.prepare(`INSERT INTO fulfilment_jobs (id,purchase_id,job_type,status,attempts,next_attempt_at,last_error,payload_json,created_at,updated_at)
    VALUES (?, ?, ?, 'queued', 0, ?, NULL, '{}', ?, ?)
    ON CONFLICT(purchase_id,job_type) DO NOTHING`)
        .run(id('job_'), purchaseId, jobType, at, at, at);
}
function sanitiseSession(session) {
    return {
        id: String(session.id || ''), mode: String(session.mode || ''), payment_status: String(session.payment_status || ''),
        amount_total: Number(session.amount_total || 0), currency: String(session.currency || 'gbp'),
        customer: String(session.customer || ''), subscription: String(session.subscription || ''),
        client_reference_id: String(session.client_reference_id || ''),
        customer_email: String(session.customer_details?.email || session.customer_email || ''),
        metadata: {
            user_id: String(session.metadata?.user_id || ''), assessment_id: String(session.metadata?.assessment_id || ''),
            project_id: String(session.metadata?.project_id || ''), product_key: String(session.metadata?.product_key || ''),
            purchase_id: String(session.metadata?.purchase_id || ''), price_id: String(session.metadata?.price_id || ''),
        },
    };
}
function integrityError(message) { const error = new Error(message); error.code = 'billing_integrity'; return error; }
async function createAlert(severity, category, message, resourceType, resourceId) {
    const existing = await db.prepare(`SELECT id FROM operational_alerts WHERE status='open' AND category=? AND resource_type=? AND resource_id=?`).get(category, resourceType, resourceId);
    if (existing)
        return existing.id;
    const alertId = id('alert_');
    await db.prepare(`INSERT INTO operational_alerts (id,severity,category,message,resource_type,resource_id,status,created_at)
    VALUES (?,?,?,?,?,?,'open',?)`).run(alertId, severity, category, String(message).slice(0, 1200), resourceType, resourceId, nowIso());
    return alertId;
}
function parse(value, fallback) {
    try {
        return JSON.parse(value || JSON.stringify(fallback));
    }
    catch {
        return fallback;
    }
}
function truncateError(error) { return String(error?.message || error || 'Unknown failure').slice(0, 1200); }
function safeFilename(value) { return String(value || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'report'; }
