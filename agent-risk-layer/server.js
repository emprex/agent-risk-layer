import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertSafeProductionConfig, config, launchReadiness, plans } from './src/config.js';
import { db, id, insertEvent, nowIso } from './src/db.js';
import { authenticateUser, changePassword, clearSession, createPasswordReset, createSession, getUserFromRequest, registerUser, resetPassword, verifyUserPassword } from './src/auth.js';
import { evaluateAssessment, questionnaire } from './src/risk-engine.js';
import { buildReport } from './src/report.js';
import { renderReportPdf } from './src/pdf.js';
import { sendPasswordChangedEmail, sendPasswordResetEmail, sendReportEmail, sendWelcomeEmail } from './src/email.js';
import { applySecurityHeaders, cleanText, issueCsrfToken, rateLimitAllowed, verifyCsrf } from './src/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  if (!rateLimitAllowed(req)) return json(res, 429, { error: 'Too many requests. Please try again shortly.' });

  const url = new URL(req.url, config.baseUrl);
  req.user = getUserFromRequest(req);

  try {
    if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') return handleStripeWebhook(req, res);
    if (req.method === 'GET' && url.pathname === '/api/csrf') return json(res, 200, { csrfToken: issueCsrfToken(req, res) });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !verifyCsrf(req)) {
      return json(res, 403, { error: 'Security token missing or invalid. Refresh the page and try again.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, version: config.appVersion, demoMode: config.demoMode, timestamp: nowIso() });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, {
        demoMode: config.demoMode,
        version: config.appVersion,
        termsVersion: config.termsVersion,
        supportEmail: config.supportEmail,
        user: req.user,
        prices: Object.fromEntries(Object.values(plans).map((plan) => [plan.key, { name: plan.name, amountPence: plan.amountPence, recurring: plan.recurring }])),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/questionnaire') return json(res, 200, { questionnaire });
    if (req.method === 'GET' && url.pathname === '/api/auth/me') return json(res, 200, { user: req.user });

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      if (!rateLimitAllowed(req, { windowMs: 60_000, max: 10, bucket: 'register' })) return json(res, 429, { error: 'Too many registration attempts.' });
      const body = await readBody(req);
      try {
        const user = registerUser(body.email, body.password, body.termsAccepted === true);
        createSession(res, user.id);
        claimAssessmentForUser(body.claimAssessmentId, body.claimToken, user.id);
        insertEvent('user_registered', user.id);
        return json(res, 201, { user });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!rateLimitAllowed(req, { windowMs: 60_000, max: 15, bucket: 'login' })) return json(res, 429, { error: 'Too many sign-in attempts.' });
      const body = await readBody(req);
      try {
        const user = authenticateUser(body.email, body.password);
        createSession(res, user.id);
        claimAssessmentForUser(body.claimAssessmentId, body.claimToken, user.id);
        insertEvent('user_logged_in', user.id);
        return json(res, 200, { user });
      } catch (error) {
        return json(res, 401, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearSession(req, res);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
      if (!rateLimitAllowed(req, { windowMs: 15 * 60_000, max: 5, bucket: 'password-reset-request' })) return json(res, 429, { error: 'Too many reset requests. Try again later.' });
      const body = await readBody(req);
      const reset = createPasswordReset(body.email);
      let demoResetUrl = null;
      if (reset) {
        await sendPasswordResetEmail({ userId: reset.user.id, to: reset.user.email, token: reset.token }).catch((error) => console.error('Password reset email failed:', error.message));
        insertEvent('password_reset_requested', reset.user.id);
        if (config.demoMode) demoResetUrl = `/reset.html?token=${encodeURIComponent(reset.token)}`;
      }
      return json(res, 200, { ok: true, message: 'If the account exists, a reset link has been sent.', demoResetUrl });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') {
      if (!rateLimitAllowed(req, { windowMs: 15 * 60_000, max: 10, bucket: 'password-reset-confirm' })) return json(res, 429, { error: 'Too many reset attempts. Try again later.' });
      const body = await readBody(req);
      try {
        const userId = resetPassword(body.token, body.password);
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
        await sendPasswordChangedEmail({ userId, to: user.email }).catch((error) => console.error('Password changed email failed:', error.message));
        insertEvent('password_reset_completed', userId);
        return json(res, 200, { ok: true });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/assessments') {
      if (!rateLimitAllowed(req, { windowMs: 60_000, max: 20, bucket: 'assessment' })) return json(res, 429, { error: 'Too many assessments submitted.' });
      const body = await readBody(req);
      try {
        const name = cleanText(body.name, 100);
        const agentType = cleanText(body.agentType, 80);
        if (name.length < 2) throw new Error('Enter a name for the agent or system.');
        if (agentType.length < 2) throw new Error('Choose an agent type.');
        const result = evaluateAssessment(body.answers || {});
        const assessmentId = id('asm_');
        const accessToken = id('access_');
        const shareToken = id('share_');
        const created = nowIso();
        db.prepare(`
          INSERT INTO assessments
          (id, user_id, name, agent_type, answers_json, score, risk_band, result_json, paid_tier, access_token, share_token, public_enabled, scoring_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 0, ?, ?, ?)
        `).run(assessmentId, req.user?.id || null, name, agentType, JSON.stringify(body.answers), result.score, result.riskBand, JSON.stringify(result), accessToken, shareToken, config.scoringVersion, created, created);
        insertEvent('assessment_completed', req.user?.id || null, { assessmentId, score: result.score, riskBand: result.riskBand, agentType });
        return json(res, 201, {
          assessment: publicAssessment({ id: assessmentId, name, agent_type: agentType, score: result.score, risk_band: result.riskBand, result_json: JSON.stringify(result), paid_tier: 'free', access_token: accessToken, share_token: shareToken, public_enabled: 0, scoring_version: config.scoringVersion, created_at: created }),
          accessToken,
        });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    let match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(decodeURIComponent(match[1]));
      if (!row) return json(res, 404, { error: 'Assessment not found.' });
      const hasToken = url.searchParams.get('token') === row.access_token;
      const isOwner = Boolean(req.user && row.user_id === req.user.id);
      if (!hasToken && !isOwner) return json(res, 403, { error: 'This assessment is private.' });
      const subscribed = Boolean(isOwner && hasActiveSubscription(req.user.id));
      const effectiveTier = subscribed ? 'pro' : row.paid_tier;
      return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier), canDownload: effectiveTier !== 'free', isOwner, subscriptionAccess: subscribed });
    }

    match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/claim$/);
    if (req.method === 'POST' && match) {
      if (!requireUser(req, res)) return;
      const body = await readBody(req);
      const claimed = claimAssessmentForUser(decodeURIComponent(match[1]), body.token, req.user.id);
      return claimed ? json(res, 200, { ok: true }) : json(res, 400, { error: 'The assessment could not be claimed.' });
    }

    match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/sharing$/);
    if (req.method === 'POST' && match) {
      if (!requireUser(req, res)) return;
      const body = await readBody(req);
      const assessmentId = decodeURIComponent(match[1]);
      const row = db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, req.user.id);
      if (!row) return json(res, 404, { error: 'Assessment not found.' });
      const enabled = body.enabled === true ? 1 : 0;
      db.prepare('UPDATE assessments SET public_enabled = ?, updated_at = ? WHERE id = ?').run(enabled, nowIso(), assessmentId);
      insertEvent(enabled ? 'sharing_enabled' : 'sharing_disabled', req.user.id, { assessmentId });
      return json(res, 200, { publicEnabled: Boolean(enabled) });
    }

    match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);
    if (req.method === 'DELETE' && match) {
      if (!requireUser(req, res)) return;
      const assessmentId = decodeURIComponent(match[1]);
      const row = db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, req.user.id);
      if (!row) return json(res, 404, { error: 'Assessment not found.' });
      db.prepare('DELETE FROM assessments WHERE id = ?').run(assessmentId);
      insertEvent('assessment_deleted', req.user.id, { assessmentId });
      return json(res, 200, { ok: true });
    }

    match = url.pathname.match(/^\/api\/public\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const row = db.prepare('SELECT * FROM assessments WHERE share_token = ? AND public_enabled = 1').get(decodeURIComponent(match[1]));
      return row ? json(res, 200, { assessment: publicAssessment(row) }) : json(res, 404, { error: 'This shared assessment is unavailable.' });
    }

    match = url.pathname.match(/^\/badge\/([^/]+)\.svg$/);
    if (req.method === 'GET' && match) return serveBadge(res, decodeURIComponent(match[1]));

    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      if (!requireUser(req, res)) return;
      if (!rateLimitAllowed(req, { windowMs: 60_000, max: 20, bucket: 'checkout' })) return json(res, 429, { error: 'Too many checkout attempts.' });
      const body = await readBody(req);
      return createCheckout(req, res, body);
    }

    if (req.method === 'GET' && url.pathname === '/api/checkout/status') {
      if (!requireUser(req, res)) return;
      return checkoutStatus(req, res, url.searchParams.get('session_id'));
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/portal') {
      if (!requireUser(req, res)) return;
      return createBillingPortal(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/subscriptions/demo-cancel') {
      if (!requireUser(req, res)) return;
      if (!config.demoMode) return json(res, 400, { error: 'Use the Stripe billing portal.' });
      db.prepare(`UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE user_id = ?`).run(nowIso(), req.user.id);
      insertEvent('subscription_cancelled', req.user.id, { mode: 'demo' });
      return json(res, 200, { ok: true });
    }

    match = url.pathname.match(/^\/api\/reports\/([^/]+)\/pdf$/);
    if (req.method === 'GET' && match) return downloadReport(req, res, decodeURIComponent(match[1]), url.searchParams.get('token'));

    if (req.method === 'GET' && url.pathname === '/api/account/export') {
      if (!requireUser(req, res)) return;
      return exportAccount(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/account/password') {
      if (!requireUser(req, res)) return;
      const body = await readBody(req);
      try {
        changePassword(req.user.id, body.currentPassword, body.newPassword);
        createSession(res, req.user.id);
        await sendPasswordChangedEmail({ userId: req.user.id, to: req.user.email }).catch((error) => console.error('Password changed email failed:', error.message));
        insertEvent('password_changed', req.user.id);
        return json(res, 200, { ok: true });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/account/delete') {
      if (!requireUser(req, res)) return;
      const body = await readBody(req);
      return deleteAccount(req, res, body);
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      if (!requireUser(req, res)) return;
      return dashboard(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
      if (!requireUser(req, res)) return;
      return adminAnalytics(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/readiness') {
      if (!requireUser(req, res)) return;
      if (!config.adminEmail || req.user.email !== config.adminEmail) return json(res, 403, { error: 'Admin access required.' });
      return json(res, 200, launchReadiness());
    }

    if (req.method === 'GET' && ['/privacy', '/privacy.html'].includes(url.pathname)) return html(res, 200, renderPrivacyPage());
    if (req.method === 'GET' && ['/terms', '/terms.html'].includes(url.pathname)) return html(res, 200, renderTermsPage());
    if (req.method === 'GET' && url.pathname === '/robots.txt') return text(res, 200, renderRobots());
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') return xml(res, 200, renderSitemap());
    if (req.method === 'GET' && url.pathname === '/.well-known/security.txt') return text(res, 200, renderSecurityTxt());

    match = url.pathname.match(/^\/checks\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const page = seoPages[decodeURIComponent(match[1])];
      if (page) return html(res, 200, renderSeoPage(page));
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, req, res);
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return json(res, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { error: error.code === 'BODY_TOO_LARGE' ? 'Request body is too large.' : 'Unexpected server error.' });
    res.end();
  }
});

async function handleStripeWebhook(req, res) {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) return text(res, 503, 'Stripe is not configured.');
  const raw = await readRawBody(req, 1_000_000);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) return text(res, 400, 'Webhook signature error.');
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return text(res, 400, 'Invalid webhook JSON.'); }
  try {
    if (event.id && db.prepare('SELECT 1 AS ok FROM stripe_events WHERE id = ?').get(event.id)) return json(res, 200, { received: true, duplicate: true });
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' || session.payment_status === 'paid' || session.payment_status === 'no_payment_required') await fulfilCheckout(session);
    }
    if (event.type === 'checkout.session.async_payment_succeeded') await fulfilCheckout(event.data.object);
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') syncSubscription(event.data.object);
    if (event.type === 'invoice.payment_failed') {
      const subscriptionId = String(event.data.object.subscription || '');
      if (subscriptionId) db.prepare(`UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE stripe_subscription_id = ?`).run(nowIso(), subscriptionId);
    }
    if (event.id) db.prepare('INSERT INTO stripe_events (id, event_type, processed_at) VALUES (?, ?, ?)').run(event.id, event.type, nowIso());
    return json(res, 200, { received: true });
  } catch (error) {
    console.error('Webhook fulfilment failed:', error);
    return text(res, 500, 'Webhook fulfilment failed.');
  }
}

async function createCheckout(req, res, body) {
  try {
    const productKey = cleanText(body.productKey, 40);
    const plan = plans[productKey];
    if (!plan) throw new Error('Unknown product.');
    let assessment = null;
    if (!plan.recurring) {
      assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?').get(body.assessmentId, req.user.id);
      if (!assessment) throw new Error('Choose an assessment saved to your account.');
      if (hasOpenSubscription(req.user.id)) throw new Error('Your subscription already provides report access or requires billing attention.');
      if (assessment.paid_tier === 'pro') throw new Error('This assessment already has a Professional report.');
      if (assessment.paid_tier === 'basic' && productKey === 'basic_report') throw new Error('This assessment already has an Essential report.');
    } else if (hasOpenSubscription(req.user.id)) {
      throw new Error('A subscription already exists or requires billing attention. Manage it from the dashboard.');
    }

    if (config.demoMode) {
      const sessionId = id('demo_cs_');
      await fulfilCheckout({
        id: sessionId,
        mode: plan.recurring ? 'subscription' : 'payment',
        payment_status: 'paid',
        customer: `demo_customer_${req.user.id}`,
        subscription: plan.recurring ? id('demo_sub_') : null,
        metadata: { user_id: req.user.id, assessment_id: assessment?.id || '', product_key: productKey },
      });
      return json(res, 200, { url: `/success.html?session_id=${encodeURIComponent(sessionId)}`, demo: true });
    }

    const price = config.stripePrices[productKey];
    if (!config.stripeSecretKey || !price) throw new Error(`Stripe is not fully configured for ${productKey}.`);
    const params = new URLSearchParams();
    params.set('mode', plan.recurring ? 'subscription' : 'payment');
    params.set('line_items[0][price]', price);
    params.set('line_items[0][quantity]', '1');
    params.set('customer_email', req.user.email);
    params.set('client_reference_id', req.user.id);
    params.set('allow_promotion_codes', 'true');
    params.set('billing_address_collection', 'auto');
    params.set('success_url', `${config.baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', assessment ? `${config.baseUrl}/result.html?id=${assessment.id}&token=${assessment.access_token}&cancelled=1` : `${config.baseUrl}/pricing.html?cancelled=1`);
    params.set('metadata[user_id]', req.user.id);
    params.set('metadata[assessment_id]', assessment?.id || '');
    params.set('metadata[product_key]', productKey);
    if (plan.recurring) {
      params.set('subscription_data[metadata][user_id]', req.user.id);
      params.set('subscription_data[metadata][product_key]', productKey);
    }
    const session = await stripeRequest('POST', '/v1/checkout/sessions', params);
    return json(res, 200, { url: session.url, demo: false });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

async function checkoutStatus(req, res, sessionIdValue) {
  try {
    const sessionId = cleanText(sessionIdValue, 200);
    let purchase = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!purchase && !config.demoMode && sessionId.startsWith('cs_')) {
      const session = await stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (session.metadata?.user_id !== req.user.id) throw new Error('Checkout session does not belong to this account.');
      if (session.mode === 'subscription' || session.payment_status === 'paid' || session.payment_status === 'no_payment_required') await fulfilCheckout(session);
      purchase = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    }
    const subscription = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(req.user.id);
    return json(res, 200, { purchase: purchase || null, subscription: subscription || null });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

async function createBillingPortal(req, res) {
  try {
    const subscription = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(req.user.id);
    if (!subscription) throw new Error('No subscription found.');
    if (config.demoMode) return json(res, 200, { url: '/dashboard.html?billing=demo' });
    if (!subscription.stripe_customer_id) throw new Error('Stripe billing is not available.');
    const params = new URLSearchParams({ customer: subscription.stripe_customer_id, return_url: `${config.baseUrl}/dashboard.html` });
    const portal = await stripeRequest('POST', '/v1/billing_portal/sessions', params);
    return json(res, 200, { url: portal.url });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

async function downloadReport(req, res, assessmentId, token) {
  const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
  if (!row) return json(res, 404, { error: 'Assessment not found.' });
  const hasToken = token === row.access_token;
  const isOwner = Boolean(req.user && row.user_id === req.user.id);
  const subscribed = Boolean(isOwner && hasActiveSubscription(req.user.id));
  const effectiveTier = subscribed ? 'pro' : row.paid_tier;
  if ((!hasToken && !isOwner) || effectiveTier === 'free') return json(res, 403, { error: 'A paid report or active subscription is required.' });
  try {
    const report = buildReport({ ...row, paid_tier: effectiveTier }, effectiveTier);
    const pdf = await renderReportPdf(report);
    insertEvent('report_downloaded', req.user?.id || null, { assessmentId: row.id, tier: effectiveTier });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename(row.name)}-agent-risk-report.pdf"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'private, no-store',
    });
    return res.end(pdf);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'The PDF could not be generated.' });
  }
}

function exportAccount(req, res) {
  const user = db.prepare('SELECT id, email, terms_version, terms_accepted_at, created_at FROM users WHERE id = ?').get(req.user.id);
  const assessments = db.prepare('SELECT id, name, agent_type, answers_json, score, risk_band, result_json, paid_tier, public_enabled, scoring_version, created_at, updated_at FROM assessments WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
    .map((row) => ({ ...row, answers: JSON.parse(row.answers_json), result: JSON.parse(row.result_json), answers_json: undefined, result_json: undefined, public_enabled: Boolean(row.public_enabled) }));
  const purchases = db.prepare('SELECT id, assessment_id, product_key, amount_pence, currency, status, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const subscriptions = db.prepare('SELECT plan_key, status, current_period_end, created_at, updated_at FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const payload = JSON.stringify({ exportedAt: nowIso(), service: config.companyName, version: config.appVersion, user, assessments, purchases, subscriptions }, null, 2);
  insertEvent('account_exported', req.user.id);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="agentrisklayer-data-export.json"', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'private, no-store' });
  return res.end(payload);
}

function deleteAccount(req, res, body) {
  if (body.confirmation !== 'DELETE') return json(res, 400, { error: 'Type DELETE to confirm account deletion.' });
  if (!verifyUserPassword(req.user.id, body.password)) return json(res, 401, { error: 'Password is incorrect.' });
  if (hasOpenSubscription(req.user.id)) return json(res, 409, { error: 'Cancel or resolve the subscription from billing before deleting the account.' });
  const userId = req.user.id;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM email_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM purchases WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM assessments WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Account deletion failed:', error);
    return json(res, 500, { error: 'The account could not be deleted.' });
  }
  clearSession(req, res);
  return json(res, 200, { ok: true });
}

function dashboard(req, res) {
  const assessments = db.prepare(`SELECT id, name, agent_type, score, risk_band, paid_tier, access_token, share_token, public_enabled, scoring_version, created_at FROM assessments WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
  const purchases = db.prepare(`SELECT id, assessment_id, product_key, amount_pence, currency, status, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
  const subscription = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(req.user.id) || null;
  const stats = {
    assessments: assessments.length,
    averageScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length) : 0,
    critical: assessments.filter((item) => item.risk_band === 'Critical').length,
    paidReports: assessments.filter((item) => item.paid_tier !== 'free').length,
  };
  return json(res, 200, { user: req.user, assessments, purchases, subscription, stats });
}

function adminAnalytics(req, res) {
  if (!config.adminEmail || req.user.email !== config.adminEmail) return json(res, 403, { error: 'Admin access required.' });
  const totals = {
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    assessments: db.prepare('SELECT COUNT(*) AS count FROM assessments').get().count,
    purchases: db.prepare(`SELECT COUNT(*) AS count FROM purchases WHERE status = 'paid'`).get().count,
    revenuePence: db.prepare(`SELECT COALESCE(SUM(amount_pence), 0) AS total FROM purchases WHERE status = 'paid'`).get().total,
    activeSubscriptions: db.prepare(`SELECT COUNT(*) AS count FROM subscriptions WHERE status IN ('active','trialing')`).get().count,
  };
  const funnel = db.prepare(`SELECT name, COUNT(*) AS count FROM events GROUP BY name ORDER BY count DESC`).all();
  const recentFailures = db.prepare(`SELECT to_email, subject, error, created_at FROM email_log WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`).all();
  const riskBands = db.prepare(`SELECT risk_band AS band, COUNT(*) AS count FROM assessments GROUP BY risk_band ORDER BY count DESC`).all();
  return json(res, 200, { totals, funnel, recentFailures, riskBands, readiness: launchReadiness() });
}

async function fulfilCheckout(session) {
  const metadata = session.metadata || {};
  const userId = metadata.user_id;
  const productKey = metadata.product_key;
  const assessmentId = metadata.assessment_id || null;
  const plan = plans[productKey];
  if (!userId || !plan) throw new Error('Checkout metadata is incomplete.');
  const existing = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get(session.id);
  if (existing) return existing;
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Checkout user not found.');
  const created = nowIso();

  const amountPence = Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : plan.amountPence;
  const currency = cleanText(session.currency || 'gbp', 8).toLowerCase();
  db.prepare(`
    INSERT INTO purchases
    (id, user_id, assessment_id, product_key, amount_pence, currency, status, stripe_session_id, stripe_customer_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
  `).run(id('pay_'), userId, assessmentId, productKey, amountPence, currency, session.id, String(session.customer || ''), created, created);

  if (plan.recurring) {
    const subscriptionId = String(session.subscription || id('sub_'));
    db.prepare(`
      INSERT INTO subscriptions
      (id, user_id, plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET status='active', plan_key=excluded.plan_key, updated_at=excluded.updated_at
    `).run(id('subrec_'), userId, productKey, String(session.customer || ''), subscriptionId, new Date(Date.now() + 31 * 86400000).toISOString(), created, created);
    insertEvent('subscription_started', userId, { productKey });
    await sendWelcomeEmail({ userId, to: user.email, planName: plan.name }).catch((error) => console.error('Welcome email failed:', error.message));
  } else {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, userId);
    if (!assessment) throw new Error('Assessment for report fulfilment not found.');
    const nextTier = assessment.paid_tier === 'pro' || plan.reportTier === 'pro' ? 'pro' : 'basic';
    db.prepare('UPDATE assessments SET paid_tier = ?, updated_at = ? WHERE id = ?').run(nextTier, nowIso(), assessment.id);
    const report = buildReport({ ...assessment, paid_tier: nextTier }, nextTier);
    const pdf = await renderReportPdf(report);
    await sendReportEmail({ userId, to: user.email, assessmentName: assessment.name, pdfBuffer: pdf, filename: `${safeFilename(assessment.name)}-agent-risk-report.pdf` })
      .catch((error) => console.error('Report email failed:', error.message));
    insertEvent('report_purchased', userId, { assessmentId, productKey, tier: nextTier });
  }
  return db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get(session.id);
}

function syncSubscription(subscription) {
  const subscriptionId = String(subscription.id);
  const row = db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscriptionId);
  const metadata = subscription.metadata || {};
  if (!row && (!metadata.user_id || !metadata.product_key)) return;
  const end = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  if (row) {
    db.prepare(`UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription_id = ?`)
      .run(subscription.status, end, nowIso(), subscriptionId);
  } else {
    db.prepare(`INSERT INTO subscriptions (id, user_id, plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('subrec_'), metadata.user_id, metadata.product_key, subscription.status, String(subscription.customer || ''), subscriptionId, end, nowIso(), nowIso());
  }
}

async function stripeRequest(method, endpoint, params = null) {
  if (!config.stripeSecretKey) throw new Error('Stripe secret key is missing.');
  const response = await fetch(`https://api.stripe.com${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${config.stripeSecretKey}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? params.toString() : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Stripe request failed.');
  return payload;
}

function verifyStripeSignature(raw, headerValue) {
  if (!headerValue) return false;
  const parts = String(headerValue).split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex');
  return signatures.some((signature) => {
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
  });
}

function serveBadge(res, shareToken) {
  const row = db.prepare('SELECT name, score, risk_band FROM assessments WHERE share_token = ? AND public_enabled = 1').get(shareToken);
  if (!row) return text(res, 404, 'Not found');
  const label = escapeXml(cleanText(row.name, 40));
  const band = escapeXml(row.risk_band);
  const score = Number(row.score);
  const accent = score >= 75 ? '#ff5964' : score >= 50 ? '#ff9f43' : score >= 25 ? '#ffd166' : '#2dd4a3';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="430" height="88" role="img" aria-label="AgentRiskLayer score ${score} out of 100"><rect width="430" height="88" rx="14" fill="#10141b"/><rect x="0" y="0" width="8" height="88" rx="4" fill="${accent}"/><text x="28" y="32" fill="#eaf2ee" font-family="Arial,sans-serif" font-size="16" font-weight="700">Assessed by AgentRiskLayer</text><text x="28" y="59" fill="#9aa8a1" font-family="Arial,sans-serif" font-size="13">${label} · ${band} risk</text><text x="356" y="54" fill="${accent}" font-family="Arial,sans-serif" font-size="24" font-weight="700">${score}/100</text></svg>`;
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(svg), 'Cache-Control': 'public, max-age=300' });
  res.end(svg);
}

function claimAssessmentForUser(assessmentId, token, userId) {
  if (!assessmentId || !token) return false;
  const row = db.prepare('SELECT user_id, access_token FROM assessments WHERE id = ?').get(String(assessmentId));
  if (!row || row.access_token !== token || (row.user_id && row.user_id !== userId)) return false;
  db.prepare('UPDATE assessments SET user_id = ?, updated_at = ? WHERE id = ?').run(userId, nowIso(), String(assessmentId));
  return true;
}

function hasActiveSubscription(userId) {
  if (!userId) return false;
  return Boolean(db.prepare(`SELECT 1 AS ok FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') LIMIT 1`).get(userId));
}

function hasOpenSubscription(userId) {
  if (!userId) return false;
  return Boolean(db.prepare(`SELECT 1 AS ok FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing','past_due','unpaid','incomplete') LIMIT 1`).get(userId));
}

function parseResult(row) { return typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json; }

function publicAssessment(row) {
  const result = parseResult(row);
  return { id: row.id, name: row.name, agentType: row.agent_type, score: row.score, riskBand: row.risk_band, paidTier: row.paid_tier, createdAt: row.created_at, shareToken: row.share_token, publicEnabled: Boolean(row.public_enabled), scoringVersion: row.scoring_version || 'arl-risk-v1.0', headline: result.headline, topFindings: result.topFindings, controls: result.controls, methodology: result.methodology };
}

function accessibleAssessment(row, effectiveTier = row.paid_tier) {
  const result = parseResult(row);
  const base = { ...publicAssessment(row), paidTier: effectiveTier };
  if (effectiveTier === 'free') return { ...base, result: { score: result.score, riskBand: result.riskBand, headline: result.headline, methodology: result.methodology, topFindings: result.topFindings, findings: result.topFindings, controls: result.controls, recommendations: [] } };
  return { ...base, result };
}

function requireUser(req, res) {
  if (req.user) return true;
  json(res, 401, { error: 'Sign in required.' });
  return false;
}

async function readRawBody(req, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  const contentType = String(req.headers['content-type'] || '').split(';')[0];
  if (contentType === 'application/json') return JSON.parse(raw.toString('utf8'));
  if (contentType === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  return {};
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function xml(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(pathname, req, res) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(requested)) requested += '.html';
  const candidate = path.resolve(publicDir, `.${decodeURIComponent(requested)}`);
  if (!candidate.startsWith(publicDir + path.sep)) return text(res, 403, 'Forbidden');
  let stat;
  try { stat = fs.statSync(candidate); } catch {
    const notFound = path.join(publicDir, '404.html');
    const body = fs.readFileSync(notFound);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }
  if (!stat.isFile()) return text(res, 404, 'Not found');
  const body = fs.readFileSync(candidate);
  const type = mimeTypes[path.extname(candidate).toLowerCase()] || 'application/octet-stream';
  const cache = candidate.endsWith('.html') ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache });
  return req.method === 'HEAD' ? res.end() : res.end(body);
}

function safeFilename(value) { return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assessment'; }
function escapeXml(value) { return String(value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]); }

function legalOperator() {
  return {
    name: config.companyLegalName || `${config.companyName} operator (not configured)`,
    address: config.companyAddress || 'Business address not configured',
    email: config.supportEmail || 'Support email not configured',
    jurisdiction: config.legalJurisdiction || 'Jurisdiction not configured',
  };
}

function legalShell(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(title)} | AgentRiskLayer</title><meta name="robots" content="index,follow"><link rel="stylesheet" href="/styles.css"></head><body><header class="site-header"><a class="brand" href="/"><span class="brand-mark">AR</span>AgentRiskLayer</a><nav><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav></header><main class="app-shell"><article class="panel legal-copy">${content}</article></main><footer><span>© 2026 AgentRiskLayer</span><span>Version ${escapeXml(config.termsVersion)}</span></footer></body></html>`;
}

function renderPrivacyPage() {
  const operator = legalOperator();
  return legalShell('Privacy Notice', `<h1 style="font-size:48px">Privacy notice</h1><p class="muted">Effective ${escapeXml(config.termsVersion)}</p><h2>Who operates the service</h2><p>${escapeXml(operator.name)}, ${escapeXml(operator.address)}. Privacy contact: ${escapeXml(operator.email)}.</p><h2>Information we process</h2><ul><li>Account email address, password hash, consent record and session records.</li><li>Assessment answers, scores, reports, sharing settings and timestamps.</li><li>Purchase, subscription and transactional-email references.</li><li>Security and product events used to prevent abuse and operate the service.</li></ul><h2>Why we process it</h2><p>We process this information to provide requested assessments and reports, perform the contract, secure accounts, fulfil payments, maintain records and improve service reliability.</p><h2>Processors</h2><p>Stripe processes live payments, subscriptions and billing. Resend delivers transactional email. The selected hosting provider stores and serves application data. Card details are not stored by AgentRiskLayer.</p><h2>Sharing and public results</h2><p>Assessments are private by default. A public summary and badge are exposed only after the account owner enables public sharing. Sharing can be disabled from the result page.</p><h2>Retention and your controls</h2><p>Account holders can download a structured data export and permanently delete their account from the dashboard. Billing records may need to be retained by payment providers or the operator where law requires it.</p><h2>Your rights</h2><p>Depending on applicable law, you may request access, correction, deletion, restriction, portability or objection. Contact ${escapeXml(operator.email)}. You may also complain to the relevant supervisory authority.</p><h2>International processing and security</h2><p>Processors may operate internationally under their own data-protection terms. We use salted password hashing, HTTP-only sessions, CSRF controls, access checks and encrypted HTTPS transport in production.</p><h2>Changes</h2><p>Material changes will be reflected by a new effective date. This notice should be reviewed by qualified counsel before public launch.</p>`);
}

function renderTermsPage() {
  const operator = legalOperator();
  return legalShell('Terms of Service', `<h1 style="font-size:48px">Terms of service</h1><p class="muted">Effective ${escapeXml(config.termsVersion)}</p><h2>Operator</h2><p>The service is operated by ${escapeXml(operator.name)}, ${escapeXml(operator.address)}. Contact: ${escapeXml(operator.email)}.</p><h2>Service scope</h2><p>AgentRiskLayer provides automated security decision support based on information supplied by the user. It is not a penetration test, certification, guarantee, insurance product or legal opinion.</p><h2>Accounts and acceptable use</h2><p>You must provide accurate account details, protect credentials and use the service lawfully. You may not probe, disrupt, reverse engineer, abuse rate limits or submit information you are not authorised to process.</p><h2>User responsibility</h2><p>You are responsible for input accuracy, professional review, control implementation, system testing and compliance with law, regulation and contracts. A score does not establish that a system is safe.</p><h2>Payments and subscriptions</h2><p>One-off reports are fulfilled after confirmed payment. Recurring plans continue until cancelled through the billing portal. Prices, taxes and renewal information are shown at checkout. Statutory consumer rights are not excluded.</p><h2>Intellectual property</h2><p>You retain rights in submitted information. The operator retains rights in the software, scoring methodology, report design and service branding. You may use purchased reports internally and share them with advisers and stakeholders.</p><h2>Availability and changes</h2><p>The service may change, be suspended for maintenance or be withdrawn. We do not promise uninterrupted availability. Material scoring-model changes are identified by a scoring-version reference.</p><h2>Liability</h2><p>Nothing excludes liability that cannot legally be excluded. Any additional limitation of liability, refund treatment and business-customer terms must be reviewed for the laws of ${escapeXml(operator.jurisdiction)} before public launch.</p><h2>Termination and deletion</h2><p>You may stop using the service and delete your account after cancelling an active subscription. We may suspend access for security, non-payment or material breach.</p><h2>Governing law</h2><p>These terms are intended to be governed by the laws and courts of ${escapeXml(operator.jurisdiction)}, subject to mandatory consumer protections. Obtain legal review before relying on this clause.</p>`);
}

function renderRobots() {
  return `User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /admin.html\nDisallow: /auth.html\nDisallow: /reset.html\nDisallow: /result.html\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}

function renderSitemap() {
  const paths = ['/', '/assessment.html', '/pricing.html', '/privacy.html', '/terms.html', ...Object.keys(seoPages).map((slug) => `/checks/${slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((item) => `<url><loc>${escapeXml(config.baseUrl + item)}</loc></url>`).join('')}</urlset>`;
}

function renderSecurityTxt() {
  const contact = config.supportEmail ? `mailto:${config.supportEmail}` : config.baseUrl;
  return `Contact: ${contact}\nCanonical: ${config.baseUrl}/.well-known/security.txt\nPolicy: ${config.baseUrl}/terms.html\nExpires: ${new Date(Date.now() + 365 * 86400000).toISOString()}\n`;
}

const seoPages = {
  'email-agent-risk-assessment': { title: 'Email Agent Risk Assessment', type: 'Email agent', description: 'Check inbox access, prompt injection, impersonation, credential scope and autonomous sending risk.' },
  'customer-support-agent-security-check': { title: 'Customer Support Agent Security Check', type: 'Customer support agent', description: 'Assess customer-data exposure, account actions, approval boundaries, audit trails and escalation controls.' },
  'mcp-server-risk-assessment': { title: 'MCP Server Risk Assessment', type: 'MCP-enabled agent', description: 'Review tool trust, server permissions, dynamic discovery, secrets, supply-chain exposure and action validation.' },
  'finance-agent-security-checklist': { title: 'Finance Agent Security Checklist', type: 'Finance agent', description: 'Measure transaction controls, reconciliation, approval thresholds, credentials and maximum-loss boundaries.' },
  'ai-assistant-permissions-checker': { title: 'AI Assistant Permissions Checker', type: 'AI assistant', description: 'Identify excessive permissions, shared identities, missing action limits and weak emergency controls.' },
};

function renderSeoPage(page) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} | AgentRiskLayer</title><meta name="description" content="${page.description}"><link rel="stylesheet" href="/styles.css"></head><body><header class="site-header"><a class="brand" href="/"><span class="brand-mark">AR</span>AgentRiskLayer</a><nav><a href="/assessment.html">Assessment</a><a href="/pricing.html">Pricing</a><a href="/auth.html">Sign in</a></nav></header><main><section class="hero compact"><div><span class="eyebrow">Free AI security check</span><h1>${page.title}</h1><p class="hero-copy">${page.description}</p><div class="button-row"><a class="button primary" href="/assessment.html?type=${encodeURIComponent(page.type)}">Start the free assessment</a><a class="button ghost" href="/pricing.html">View reports</a></div></div><div class="score-card"><span>Example residual risk</span><strong>46<small>/100</small></strong><div class="risk-pill moderate">Moderate risk</div></div></section><section class="content-section narrow"><h2>What the assessment covers</h2><div class="feature-grid"><article><h3>Permissions</h3><p>Checks whether the agent has more access than its task requires.</p></article><article><h3>Untrusted input</h3><p>Reviews how external content can influence tools and actions.</p></article><article><h3>Autonomy</h3><p>Measures approval gates, limits and potential blast radius.</p></article><article><h3>Evidence</h3><p>Evaluates logging, testing and incident containment.</p></article></div></section></main><footer><span>© 2026 AgentRiskLayer</span><span>Automated decision support, not a certification.</span></footer></body></html>`;
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(nowIso());
assertSafeProductionConfig();
server.listen(config.port, () => {
  console.log(`AgentRiskLayer running at ${config.baseUrl}`);
  console.log(`Mode: ${config.demoMode ? 'DEMO (simulated payments)' : 'LIVE'}`);
});
