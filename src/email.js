import { config } from './config.js';
import { db, id, nowIso } from './db.js';
const EMAIL_TIMEOUT_MS = 10000;
export async function sendReportEmail({ userId, to, assessmentName, pdfBuffer, filename }) {
    const subject = `Your AgentRiskLayer report — ${assessmentName}`;
    const html = emailShell(`
    <h1>Your security report is ready</h1>
    <p>The full AgentRiskLayer assessment for <strong>${escapeHtml(assessmentName)}</strong> is attached.</p>
    <p>Keep the report with your security evidence and repeat the assessment after material architecture, model, permission or tool changes.</p>
    <p><a href="${escapeHtml(config.baseUrl)}/dashboard.html">Open your security workspace</a></p>
  `);
    return await sendEmail({ userId, to, subject, html, attachments: [{ filename, content: pdfBuffer.toString('base64') }] });
}
export async function sendWelcomeEmail({ userId, to, planName }) {
    const subject = `Welcome to AgentRiskLayer ${planName}`;
    const html = emailShell(`
    <h1>Your subscription is active</h1>
    <p>You now have access to the <strong>${escapeHtml(planName)}</strong> plan.</p>
    <p><a href="${escapeHtml(config.baseUrl)}/dashboard.html">Open your workspace</a></p>
  `);
    return await sendEmail({ userId, to, subject, html });
}
export async function sendEmailVerification({ userId, to, token }) {
    const subject = 'Verify your AgentRiskLayer email';
    const verifyUrl = `${config.baseUrl}/verify.html?token=${encodeURIComponent(token)}`;
    const html = emailShell(`
    <h1>Verify your email</h1>
    <p>Confirm this address before purchasing reports, starting subscriptions or issuing security-testing tokens.</p>
    <p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#13795b;color:white;text-decoration:none;font-weight:700">Verify email</a></p>
    <p>The link expires automatically. If you did not create the account, ignore this message.</p>
  `);
    return await sendEmail({ userId, to, subject, html });
}
export async function sendOperationalAlert({ to, subject, message }) {
    const html = emailShell(`<h1>AgentRiskLayer operational alert</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(config.baseUrl)}/admin.html">Open owner operations</a></p>`);
    return await sendEmail({ userId: null, to, subject, html });
}
export async function sendPasswordResetEmail({ userId, to, token }) {
    const subject = 'Reset your AgentRiskLayer password';
    const resetUrl = `${config.baseUrl}/reset.html?token=${encodeURIComponent(token)}`;
    const html = emailShell(`
    <h1>Reset your password</h1>
    <p>Use the secure link below within 30 minutes. It can be used once.</p>
    <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#13795b;color:white;text-decoration:none;font-weight:700">Reset password</a></p>
    <p>If you did not request this, you can ignore this email.</p>
  `);
    return await sendEmail({ userId, to, subject, html });
}
export async function sendPasswordChangedEmail({ userId, to }) {
    const subject = 'Your AgentRiskLayer password was changed';
    const html = emailShell(`
    <h1>Password changed</h1>
    <p>Your AgentRiskLayer password has been changed and existing sessions were signed out.</p>
    <p>If this was not you, contact ${escapeHtml(config.supportEmail || 'support')} immediately.</p>
  `);
    return await sendEmail({ userId, to, subject, html });
}
async function sendEmail({ userId, to, subject, html, attachments }) {
    if (!config.resendApiKey) {
        await log(userId, to, subject, 'simulated');
        console.log(`[email simulated] ${subject} -> ${to}`);
        return { simulated: true };
    }
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
            headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, attachments }),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.message || payload.name || 'Resend request failed.');
        await log(userId, to, subject, 'sent', payload.id || null);
        return payload;
    }
    catch (error) {
        const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? `Email delivery timed out after ${EMAIL_TIMEOUT_MS} ms`
            : String(error?.message || 'Email delivery failed.');
        await log(userId, to, subject, 'failed', null, message);
        throw new Error(message, { cause: error });
    }
}
function emailShell(content) {
    return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17202a;line-height:1.6">${content}<hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0"><p style="color:#667085;font-size:12px">AgentRiskLayer provides automated decision support. It is not a penetration test, certification, guarantee, insurance product or legal opinion.</p></div>`;
}
async function log(userId, to, subject, status, providerId = null, error = null) {
    await db.prepare(`INSERT INTO email_log (id, user_id, to_email, subject, status, provider_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id('mail_'), userId || null, to, subject, status, providerId, error, nowIso());
}
function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
