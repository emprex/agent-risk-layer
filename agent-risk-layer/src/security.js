import crypto from 'node:crypto';
import { config } from './config.js';

const buckets = new Map();
const CSRF_COOKIE = 'arl_csrf';

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  const upgrade = config.nodeEnv === 'production' ? '; upgrade-insecure-requests' : '';
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; object-src 'none'${upgrade}`,
  );
  if (config.nodeEnv === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
}

export function rateLimitAllowed(req, { windowMs = 60_000, max = 180, bucket = 'global' } = {}) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [storedKey, value] of buckets) if (value.resetAt < now) buckets.delete(storedKey);
    }
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

export function cleanText(value, max = 120) {
  return String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 1) return ['', ''];
        try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; }
        catch { return [part.slice(0, index), '']; }
      })
      .filter(([key]) => key),
  );
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
  if (!cookieToken || !headerToken) return false;
  const origin = String(req.headers.origin || '');
  if (origin && origin !== config.baseUrl) return false;
  try {
    const left = Buffer.from(cookieToken);
    const right = Buffer.from(headerToken);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(current)) res.setHeader('Set-Cookie', [...current, cookie]);
  else res.setHeader('Set-Cookie', [current, cookie]);
}
