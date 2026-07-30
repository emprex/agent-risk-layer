import crypto from 'node:crypto';

export const APPROVAL_SCHEMA = 'arl.runtime.approval.v2';
const APPROVAL_SIGNING_CONTEXT = 'AgentRiskLayer runtime approval signing v2';
const MAX_APPROVAL_LIFETIME_SECONDS = 3600;
const MAX_ACTION_BYTES = 262144;

export const ROLE_PERMISSIONS = Object.freeze({
    viewer: ['assessment:read', 'report:read', 'event:read'],
    analyst: ['assessment:read', 'assessment:run', 'report:read', 'event:read', 'finding:review'],
    developer: ['assessment:read', 'assessment:run', 'report:read', 'event:read', 'policy:propose'],
    admin: ['assessment:*', 'report:*', 'event:*', 'finding:*', 'policy:*', 'member:*', 'approval:issue'],
    owner: ['*'],
});

export function authoriseWorkspaceAction(membership, action, resource = {}) {
    if (!membership || membership.workspaceId !== resource.workspaceId)
        return { allowed: false, reason: 'workspace-boundary' };
    const permissions = ROLE_PERMISSIONS[membership.role] || [];
    const allowed = permissions.includes('*') || permissions.includes(action) || permissions.some((p) => p.endsWith(':*') && action.startsWith(p.slice(0, -1)));
    return { allowed, reason: allowed ? 'role-permission' : 'insufficient-role', role: membership.role };
}

export function runtimeApprovalActionDigest({ workspaceId, projectId, environment, tool, arguments: args }) {
    const action = {
        workspaceId: requiredText(workspaceId, 'Workspace identifier', 160),
        projectId: requiredText(projectId, 'Project identifier', 160),
        environment: requiredText(environment, 'Environment', 40).toLowerCase(),
        tool: requiredText(tool, 'Tool identity', 200).toLowerCase(),
        arguments: args ?? {},
    };
    const canonical = canonicalJson(action);
    if (Buffer.byteLength(canonical) > MAX_ACTION_BYTES)
        throw new Error('Approval action exceeds the maximum supported size.');
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function issueApproval(payload, secret, ttlSeconds = 600) {
    const signingKey = approvalSigningKey(secret);
    const issuedAt = new Date();
    const lifetime = Math.max(30, Math.min(MAX_APPROVAL_LIFETIME_SECONDS, Number(ttlSeconds) || 600));
    const body = {
        schema: APPROVAL_SCHEMA,
        approvalId: requiredText(payload?.approvalId || crypto.randomUUID(), 'Approval identifier', 160),
        workspaceId: requiredText(payload?.workspaceId, 'Workspace identifier', 160),
        projectId: requiredText(payload?.projectId, 'Project identifier', 160),
        actionDigest: requiredDigest(payload?.actionDigest, 'Action digest'),
        tool: requiredText(payload?.tool, 'Tool identity', 200).toLowerCase(),
        environment: requiredText(payload?.environment, 'Environment', 40).toLowerCase(),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + lifetime * 1000).toISOString(),
    };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = crypto.createHmac('sha256', signingKey).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

export function verifyApproval(token, expected, secret, timestampMs = Date.now()) {
    try {
        const [encoded, signature, extra] = String(token || '').split('.');
        if (!encoded || !signature || extra)
            return { valid: false, reason: 'malformed' };
        const signingKey = approvalSigningKey(secret);
        const actual = Buffer.from(signature, 'base64url');
        const wanted = crypto.createHmac('sha256', signingKey).update(encoded).digest();
        if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted))
            return { valid: false, reason: 'signature' };
        const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (body.schema !== APPROVAL_SCHEMA)
            return { valid: false, reason: 'schema' };
        const issuedAt = Date.parse(body.issuedAt);
        const expiresAt = Date.parse(body.expiresAt);
        if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt
            || expiresAt - issuedAt > MAX_APPROVAL_LIFETIME_SECONDS * 1000
            || issuedAt > timestampMs + 60000)
            return { valid: false, reason: 'time-invalid' };
        if (expiresAt <= timestampMs)
            return { valid: false, reason: 'expired', approval: body };
        for (const key of ['approvalId', 'workspaceId', 'projectId', 'actionDigest', 'tool', 'environment']) {
            if (expected?.[key] != null && body[key] !== expected[key])
                return { valid: false, reason: `binding-${key}`, approval: body };
        }
        return { valid: true, approval: body };
    }
    catch {
        return { valid: false, reason: 'invalid' };
    }
}

export function approvalTokenDigest(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function approvalSigningKey(secret) {
    if (!secret || String(secret).length < 32)
        throw new Error('Approval signing secret must contain at least 32 characters.');
    return crypto.createHmac('sha256', String(secret)).update(APPROVAL_SIGNING_CONTEXT).digest();
}

function requiredText(value, label, max) {
    const text = String(value ?? '').trim();
    if (!text)
        throw new Error(`${label} is required.`);
    if (text.length > max)
        throw new Error(`${label} exceeds the maximum length.`);
    return text;
}

function requiredDigest(value, label) {
    const digest = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest))
        throw new Error(`${label} must be a SHA-256 digest.`);
    return digest;
}

function canonicalJson(value, depth = 0, seen = new Set()) {
    if (depth > 20)
        throw new Error('Approval action is nested too deeply.');
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('Approval action contains a non-finite number.');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        if (seen.has(value))
            throw new Error('Approval action contains a circular reference.');
        seen.add(value);
        const result = `[${value.map((item) => canonicalJson(item, depth + 1, seen)).join(',')}]`;
        seen.delete(value);
        return result;
    }
    if (value && typeof value === 'object') {
        if (seen.has(value))
            throw new Error('Approval action contains a circular reference.');
        seen.add(value);
        const entries = Object.keys(value).sort().map((key) => {
            const item = value[key];
            if (item === undefined || typeof item === 'function' || typeof item === 'symbol')
                throw new Error('Approval action contains a value that cannot be safely serialised.');
            return `${JSON.stringify(key)}:${canonicalJson(item, depth + 1, seen)}`;
        });
        seen.delete(value);
        return `{${entries.join(',')}}`;
    }
    throw new Error('Approval action contains a value that cannot be safely serialised.');
}
