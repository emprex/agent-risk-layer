import crypto from 'node:crypto';
import { config } from './config.js';
import { db, id, nowIso } from './db.js';
import { appendSetCookie, parseCookies } from './security.js';

const COOKIE_NAME = 'arl_session';
const SESSION_DAYS = 30;
const RESET_MINUTES = 30;

function b64(buffer) {
  return buffer.toString('base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${b64(salt)}$${b64(derived)}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algorithm, salt64, key64] = stored.split('$');
    if (algorithm !== 'scrypt' || !salt64 || !key64) return false;
    const salt = Buffer.from(salt64, 'base64url');
    const expected = Buffer.from(key64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function tokenHash(token, purpose = 'session') {
  return crypto.createHmac('sha256', config.sessionSecret).update(`${purpose}:${token}`).digest('hex');
}

export function createSession(res, userId) {
  const token = b64(crypto.randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash(token), userId, expires.toISOString(), nowIso());
  const sessions = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  for (const old of sessions.slice(10)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(old.token_hash);

  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  appendSetCookie(
    res,
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  );
}

export function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  appendSetCookie(res, `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function getUserFromRequest(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.email, users.terms_version, users.terms_accepted_at, users.created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), nowIso()) || null;
}

export function registerUser(email, password, termsAccepted = false) {
  const normalized = normalizeEmail(email);
  validatePassword(password);
  if (!termsAccepted) throw new Error('Accept the Terms of Service and Privacy Notice to create an account.');

  const created = nowIso();
  const user = {
    id: id('usr_'),
    email: normalized,
    terms_version: config.termsVersion,
    terms_accepted_at: created,
    created_at: created,
  };
  try {
    db.prepare(`INSERT INTO users (id, email, password_hash, terms_version, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.email, hashPassword(password), user.terms_version, user.terms_accepted_at, user.created_at);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('An account with that email already exists.');
    throw error;
  }
  return user;
}

export function authenticateUser(email, password) {
  const normalized = normalizeEmail(email);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    throw new Error('Email or password is incorrect.');
  }
  return publicUser(row);
}

export function createPasswordReset(email) {
  const normalized = normalizeEmail(email, false);
  const user = normalized ? db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalized) : null;
  if (!user) return null;
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?').run(user.id, nowIso());
  const token = b64(crypto.randomBytes(32));
  const created = nowIso();
  const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
  db.prepare(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)`)
    .run(tokenHash(token, 'password-reset'), user.id, expires, created);
  return { token, user, expires };
}

export function resetPassword(token, password) {
  validatePassword(password);
  const row = db.prepare(`
    SELECT password_reset_tokens.token_hash, password_reset_tokens.user_id
    FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(tokenHash(String(token || ''), 'password-reset'), nowIso());
  if (!row) throw new Error('This reset link is invalid or has expired.');
  const usedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(usedAt, row.token_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return row.user_id;
}

export function changePassword(userId, currentPassword, newPassword) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row || !verifyPassword(String(currentPassword || ''), row.password_hash)) throw new Error('Current password is incorrect.');
  validatePassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function verifyUserPassword(userId, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  return Boolean(row && verifyPassword(String(password || ''), row.password_hash));
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    created_at: row.created_at,
  };
}

function normalizeEmail(email, throwOnInvalid = true) {
  const normalized = String(email || '').trim().toLowerCase();
  const valid = normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  if (!valid && throwOnInvalid) throw new Error('Enter a valid email address.');
  return valid ? normalized : '';
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('Password must contain at least 12 characters.');
  if (value.length > 200) throw new Error('Password is too long.');
  if (/^\s+$/.test(value)) throw new Error('Choose a stronger password.');
}
