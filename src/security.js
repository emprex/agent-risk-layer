import crypto from 'node:crypto';
import net from 'node:net';
import { config } from './config.js';
import { db, nowIso } from './db.js';
const CSRF_COOKIE = 'arl_csrf';
let cleanupCounter = 0;
export function applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Origin-Agent-Cluster', '?1');
    const upgrade = config.nodeEnv === 'production' ? '; upgrade-insecure-requests' : '';
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; object-src 'none'${upgrade}`);
    if (config.nodeEnv === 'production')
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
}
/**
 * Render and most reverse proxies append the address they observed to the end
 * of X-Forwarded-For. Client supplied values can appear on the left, so the
 * right-most valid address is used. This prevents the spoofing flaw caused by
 * trusting the first value.
 */
export function resolveClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map((value) => normaliseIp(value.trim()))
        .filter(Boolean);
    if (forwarded.length) {
        const hops = Math.max(1, config.trustedProxyHops || 1);
        return forwarded[Math.max(0, forwarded.length - hops)] || forwarded.at(-1);
    }
    return normaliseIp(req.socket?.remoteAddress) || 'unknown';
}
export async function primaryRateLimitAllowed(req, pathname = '/') {
    const method = String(req.method || 'GET').toUpperCase();
    if (pathname === '/v1/guard') return true;
    if (pathname === '/api/health') {
        return await rateLimitAllowed(req, { windowMs: 60000, max: 1200, bucket: 'health-read' });
    }
    if (['GET', 'HEAD'].includes(method) && !pathname.startsWith('/api/')) {
        return await rateLimitAllowed(req, { windowMs: 60000, max: 900, bucket: 'public-read' });
    }
    return await rateLimitAllowed(req, { windowMs: 60000, max: 240, bucket: 'global-api' });
}
export async function rateLimitAllowed(req, { windowMs = 60000, max = 180, bucket = 'global', identity = '', penaltyMs = 0, } = {}) {
    const now = Date.now();
    const nowValue = new Date(now).toISOString();
    const resetAt = new Date(now + windowMs).toISOString();
    const ip = resolveClientIp(req);
    const key = rateKey(bucket, ip, identity);
    try {
        return await db.transaction(async () => {
            await db.prepare(`INSERT INTO rate_limit_buckets (bucket_key, count, reset_at, blocked_until, updated_at)
        VALUES (?, 0, ?, NULL, ?)
        ON CONFLICT(bucket_key) DO NOTHING`).run(key, resetAt, nowIso());
            const rowSql = `SELECT count, reset_at, blocked_until FROM rate_limit_buckets WHERE bucket_key = ?${db.kind === 'postgres' ? ' FOR UPDATE' : ''}`;
            const row = await db.prepare(rowSql).get(key);
            const blockedUntil = row?.blocked_until ? Date.parse(row.blocked_until) : 0;
            let allowed = false;
            if (blockedUntil > now) {
                allowed = false;
            }
            else if (!row || Date.parse(row.reset_at) <= now) {
                await db.prepare('UPDATE rate_limit_buckets SET count=1,reset_at=?,blocked_until=NULL,updated_at=? WHERE bucket_key=?')
                    .run(resetAt, nowIso(), key);
                allowed = true;
            }
            else {
                const nextCount = Number(row.count || 0) + 1;
                const excess = Math.max(0, nextCount - max);
                const progressivePenalty = penaltyMs && excess > 0
                    ? Math.min(24 * 60 * 60000, penaltyMs * (2 ** Math.min(6, excess - 1)))
                    : 0;
                const nextBlocked = progressivePenalty ? new Date(now + progressivePenalty).toISOString() : null;
                await db.prepare('UPDATE rate_limit_buckets SET count=?, blocked_until=COALESCE(?, blocked_until), updated_at=? WHERE bucket_key=?')
                    .run(nextCount, nextBlocked, nowIso(), key);
                allowed = nextCount <= max;
            }
            if (++cleanupCounter % 250 === 0) {
                await db.prepare('DELETE FROM rate_limit_buckets WHERE reset_at < ? AND (blocked_until IS NULL OR blocked_until < ?)').run(new Date(now - 86400000).toISOString(), nowValue);
            }
            return allowed;
        });
    }
    catch (error) {
        // Authentication and write buckets fail closed. The broad read bucket can
        // fail open so a transient database issue does not take down the whole site.
        return bucket === 'global';
    }
}

export async function clearRateLimit(req, { bucket, identity = '' }) {
    await db.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key = ?').run(rateKey(bucket, resolveClientIp(req), identity));
}
export async function rateLimitSnapshot({ limit = 100 } = {}) {
    return await db.prepare(`SELECT bucket_key, count, reset_at, blocked_until, updated_at
    FROM rate_limit_buckets ORDER BY updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(500, limit)));
}
export function cleanText(value, max = 120) {
    return String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}
export function parseCookies(header = '') {
    return Object.fromEntries(String(header)
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const index = part.indexOf('=');
        if (index < 1)
            return ['', ''];
        try {
            return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
        }
        catch {
            return [part.slice(0, index), ''];
        }
    })
        .filter(([key]) => key));
}
export function issueCsrfToken(req, res) {
    const existing = parseCookies(req.headers.cookie || '')[CSRF_COOKIE];
    const token = existing && existing.length >= 32 ? existing : crypto.randomBytes(32).toString('base64url');
    if (!existing) {
        const secure = config.nodeEnv === 'production' ? '; Secure' : '';
        appendSetCookie(res, `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=86400${secure}`);
    }
    return token;
}
export function verifyCsrf(req) {
    const cookieToken = parseCookies(req.headers.cookie || '')[CSRF_COOKIE] || '';
    const headerToken = String(req.headers['x-csrf-token'] || '');
    if (!cookieToken || !headerToken)
        return false;
    const suppliedOrigin = normaliseOrigin(req.headers.origin);
    if (suppliedOrigin) {
        const allowedOrigins = new Set([
            normaliseOrigin(config.baseUrl),
            requestOrigin(req),
        ].filter(Boolean));
        if (!allowedOrigins.has(suppliedOrigin))
            return false;
    }
    try {
        const left = Buffer.from(cookieToken);
        const right = Buffer.from(headerToken);
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    }
    catch {
        return false;
    }
}
function normaliseOrigin(value) {
    try {
        return value ? new URL(String(value)).origin : '';
    }
    catch {
        return '';
    }
}
function requestOrigin(req) {
    const host = String(req.headers.host || '').trim();
    if (!host)
        return '';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const protocol = forwardedProto === 'https' || forwardedProto === 'http'
        ? forwardedProto
        : req.socket?.encrypted ? 'https' : 'http';
    return normaliseOrigin(`${protocol}://${host}`);
}
export function appendSetCookie(res, cookie) {
    const current = res.getHeader('Set-Cookie');
    if (!current)
        res.setHeader('Set-Cookie', cookie);
    else if (Array.isArray(current))
        res.setHeader('Set-Cookie', [...current, cookie]);
    else
        res.setHeader('Set-Cookie', [current, cookie]);
}
function normaliseIp(value) {
    let ip = String(value || '').trim();
    if (ip.startsWith('::ffff:'))
        ip = ip.slice(7);
    const zone = ip.indexOf('%');
    if (zone > -1)
        ip = ip.slice(0, zone);
    return net.isIP(ip) ? ip : '';
}
function rateKey(bucket, ip, identity) {
    const identityHash = identity
        ? crypto.createHmac('sha256', config.sessionSecret).update(String(identity).trim().toLowerCase()).digest('hex').slice(0, 24)
        : '-';
    const ipHash = crypto.createHmac('sha256', config.sessionSecret).update(ip).digest('hex').slice(0, 24);
    return `${cleanText(bucket, 48)}:${ipHash}:${identityHash}`;
}
