import { config } from './config.js';
import { db, id, nowIso } from './db.js';

export async function sendReportEmail({ userId, to, assessmentName, pdfBuffer, filename }) {
  const subject = `Your AgentRiskLayer report — ${assessmentName}`;
  const html = emailShell(`
    <h1>Your security report is ready</h1>
    <p>The full AgentRiskLayer assessment for <strong>${escapeHtml(assessmentName)}</strong> is attached.</p>
    <p>Keep the report with your security evidence and repeat the assessment after material architecture, model, permission or tool changes.</p>
    <p><a href="${escapeHtml(config.baseUrl)}/dashboard.html">Open your security workspace</a></p>
  `);
  return sendEmail({ userId, to, subject, html, attachments: [{ filename, content: pdfBuffer.toString('base64') }] });
}

export async function sendWelcomeEmail({ userId, to, planName }) {
  const subject = `Welcome to AgentRiskLayer ${planName}`;
  const html = emailShell(`
    <h1>Your subscription is active</h1>
    <p>You now have access to the <strong>${escapeHtml(planName)}</strong> plan.</p>
    <p><a href="${escapeHtml(config.baseUrl)}/dashboard.html">Open your workspace</a></p>
  `);
  return sendEmail({ userId, to, subject, html });
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
  return sendEmail({ userId, to, subject, html });
}

export async function sendPasswordChangedEmail({ userId, to }) {
  const subject = 'Your AgentRiskLayer password was changed';
  const html = emailShell(`
    <h1>Password changed</h1>
    <p>Your AgentRiskLayer password has been changed and existing sessions were signed out.</p>
    <p>If this was not you, contact ${escapeHtml(config.supportEmail || 'support')} immediately.</p>
  `);
  return sendEmail({ userId, to, subject, html });
}

async function sendEmail({ userId, to, subject, html, attachments }) {
  if (!config.resendApiKey) {
    log(userId, to, subject, 'simulated');
    console.log(`[email simulated] ${subject} -> ${to}`);
    return { simulated: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, attachments }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || payload.name || 'Resend request failed.');
    log(userId, to, subject, 'sent', payload.id || null);
    return payload;
  } catch (error) {
    log(userId, to, subject, 'failed', null, error.message);
    throw error;
  }
}

function emailShell(content) {
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17202a;line-height:1.6">${content}<hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0"><p style="color:#667085;font-size:12px">AgentRiskLayer provides automated decision support. It is not a penetration test, certification, guarantee, insurance product or legal opinion.</p></div>`;
}

function log(userId, to, subject, status, providerId = null, error = null) {
  db.prepare(`INSERT INTO email_log (id, user_id, to_email, subject, status, provider_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id('mail_'), userId || null, to, subject, status, providerId, error, nowIso());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
