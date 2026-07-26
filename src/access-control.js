import crypto from 'node:crypto';
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
export function issueApproval(payload, secret, ttlSeconds = 300) {
    if (!secret || String(secret).length < 32)
        throw new Error('Approval signing secret must contain at least 32 characters.');
    const body = { schema: 'arl.approval.v1', approvalId: String(payload.approvalId || crypto.randomUUID()), workspaceId: String(payload.workspaceId || ''), actionDigest: String(payload.actionDigest || ''), environment: String(payload.environment || ''), approverId: String(payload.approverId || ''), expiresAt: new Date(Date.now() + Math.max(30, Math.min(3600, ttlSeconds)) * 1000).toISOString() };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}
export function verifyApproval(token, expected, secret) {
    try {
        const [encoded, signature] = String(token || '').split('.');
        if (!encoded || !signature || !secret)
            return { valid: false, reason: 'malformed' };
        const actual = Buffer.from(signature, 'base64url');
        const wanted = crypto.createHmac('sha256', secret).update(encoded).digest();
        if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted))
            return { valid: false, reason: 'signature' };
        const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (body.schema !== 'arl.approval.v1' || Date.parse(body.expiresAt) <= Date.now())
            return { valid: false, reason: 'expired' };
        for (const key of ['workspaceId', 'actionDigest', 'environment'])
            if (expected?.[key] != null && body[key] !== expected[key])
                return { valid: false, reason: `binding-${key}` };
        return { valid: true, approval: body };
    }
    catch {
        return { valid: false, reason: 'invalid' };
    }
}
