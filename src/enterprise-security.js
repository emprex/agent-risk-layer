import crypto from 'node:crypto';
export const ENTERPRISE_EVENT_SCHEMA = 'arl.enterprise.event.v1';
export function createSsoState({ workspaceId, returnTo = '/dashboard.html' }, secret, ttlSeconds = 300) {
    requireSecret(secret);
    const body = { schema: 'arl.sso.state.v1', workspaceId: safeId(workspaceId), returnTo: safeReturnPath(returnTo), nonce: crypto.randomBytes(16).toString('base64url'), expiresAt: new Date(Date.now() + Math.max(60, Math.min(900, ttlSeconds)) * 1000).toISOString() };
    return sign(body, secret);
}
export function verifySsoState(token, secret) {
    const result = verify(token, secret);
    if (!result.valid || result.body.schema !== 'arl.sso.state.v1')
        return { valid: false, reason: result.reason || 'schema' };
    if (Date.parse(result.body.expiresAt) <= Date.now())
        return { valid: false, reason: 'expired' };
    return { valid: true, state: result.body };
}
export function normaliseScimUser(input = {}) {
    const email = String(input.userName || input.emails?.find((item) => item.primary)?.value || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        throw new Error('SCIM user requires a valid email address.');
    return { schema: 'arl.scim.user.v1', externalId: safeId(input.externalId || input.id), email, displayName: String(input.displayName || [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ') || email).slice(0, 120), active: input.active !== false, role: normaliseRole(input.role || input.roles?.[0]?.value) };
}
export function buildSecurityNotification(event = {}, destination = 'generic') {
    const severity = ['low', 'medium', 'high', 'critical'].includes(event.severity) ? event.severity : 'medium';
    const canonical = { schema: ENTERPRISE_EVENT_SCHEMA, id: safeId(event.id || crypto.randomUUID()), occurredAt: event.occurredAt || new Date().toISOString(), workspaceId: safeId(event.workspaceId), severity, title: String(event.title || 'AgentRiskLayer security event').slice(0, 180), decision: String(event.decision || 'review').slice(0, 40), evidenceUrl: safeHttpsUrl(event.evidenceUrl) };
    if (destination === 'slack')
        return { text: `*${canonical.severity.toUpperCase()}* · ${canonical.title}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${canonical.title}*\nDecision: \`${canonical.decision}\`\nEvidence: ${canonical.evidenceUrl || 'Available in AgentRiskLayer'}` } }], metadata: canonical };
    if (destination === 'jira')
        return { fields: { summary: `[${canonical.severity.toUpperCase()}] ${canonical.title}`, description: `Decision: ${canonical.decision}\nEvidence: ${canonical.evidenceUrl || 'Available in AgentRiskLayer'}`, labels: ['agentrisklayer', `severity-${canonical.severity}`] }, metadata: canonical };
    return canonical;
}
export function signWebhookPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
    requireSecret(secret);
    const body = JSON.stringify(payload);
    return { body, timestamp, signature: `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` };
}
export function verifyWebhookPayload({ body, timestamp, signature }, secret, toleranceSeconds = 300) {
    try {
        requireSecret(secret);
        if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > toleranceSeconds)
            return { valid: false, reason: 'timestamp' };
        const expected = `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
        const left = Buffer.from(String(signature));
        const right = Buffer.from(expected);
        const valid = left.length === right.length && crypto.timingSafeEqual(left, right);
        return { valid, reason: valid ? 'verified' : 'signature' };
    }
    catch {
        return { valid: false, reason: 'invalid' };
    }
}
function sign(body, secret) { const encoded = Buffer.from(JSON.stringify(body)).toString('base64url'); return `${encoded}.${crypto.createHmac('sha256', secret).update(encoded).digest('base64url')}`; }
function verify(token, secret) {
    try {
        requireSecret(secret);
        const [encoded, signature] = String(token || '').split('.');
        const wanted = crypto.createHmac('sha256', secret).update(encoded).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted))
            return { valid: false, reason: 'signature' };
        return { valid: true, body: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) };
    }
    catch {
        return { valid: false, reason: 'invalid' };
    }
}
function requireSecret(secret) {
    if (!secret || String(secret).length < 32)
        throw new Error('Signing secret must contain at least 32 characters.');
}
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120); }
function normaliseRole(value) { return ['viewer', 'analyst', 'developer', 'admin', 'owner'].includes(value) ? value : 'viewer'; }
function safeReturnPath(value) { const valueString = String(value || ''); return valueString.startsWith('/') && !valueString.startsWith('//') ? valueString.slice(0, 300) : '/dashboard.html'; }
function safeHttpsUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.toString().slice(0, 500) : '';
    }
    catch {
        return '';
    }
}
