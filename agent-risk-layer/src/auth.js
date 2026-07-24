import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db, id, nowIso } from './db.js';
import { appendSetCookie, parseCookies } from './security.js';

const scryptAsync = promisify(crypto.scrypt);
const COOKIE_NAME = 'arl_session';
const RESET_MINUTES = 30;
const MFA_CHALLENGE_MINUTES = 5;
const TOTP_STEP_SECONDS = 30;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b64(buffer) { return buffer.toString('base64url'); }

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${b64(salt)}$${b64(derived)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, salt64, key64] = String(stored || '').split('$');
    if (algorithm !== 'scrypt' || !salt64 || !key64) return false;
    const salt = Buffer.from(salt64, 'base64url');
    const expected = Buffer.from(key64, 'base64url');
    const actual = await scryptAsync(String(password || ''), salt, expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function tokenHash(token, purpose = 'session') {
  return crypto.createHmac('sha256', config.sessionSecret).update(`${purpose}:${token}`).digest('hex');
}

export function createSession(res, userId, { mfaVerified = false } = {}) {
  const token = b64(crypto.randomBytes(32));
  const now = nowIso();
  const expires = new Date(Date.now() + config.sessionAbsoluteDays * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?')
    .run(now, new Date(Date.now() - config.sessionIdleHours * 3600000).toISOString());
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, authenticated_at, mfa_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tokenHash(token), userId, expires.toISOString(), now, now, now, mfaVerified ? 1 : 0);
  const sessions = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  for (const old of sessions.slice(10)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(old.token_hash);

  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  appendSetCookie(
    res,
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionAbsoluteDays * 86400}${secure}`,
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
  const now = nowIso();
  const idleCutoff = new Date(Date.now() - config.sessionIdleHours * 3600000).toISOString();
  const row = db.prepare(`
    SELECT users.id, users.email, users.email_verified_at, users.mfa_enabled_at,
           users.terms_version, users.terms_accepted_at, users.created_at,
           sessions.token_hash AS session_token_hash, sessions.last_seen_at,
           sessions.authenticated_at, sessions.mfa_verified
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND sessions.last_seen_at > ?
  `).get(tokenHash(token), now, idleCutoff);
  if (!row) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return null;
  }
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, row.session_token_hash);
    row.last_seen_at = now;
  }
  const user = publicUser(row);
  Object.defineProperty(user, '_sessionTokenHash', { value: row.session_token_hash, enumerable: false });
  return user;
}

export async function registerUser(email, password, termsAccepted = false) {
  const normalized = normalizeEmail(email);
  validatePassword(password);
  if (!termsAccepted) throw new Error('Accept the Terms of Service and Privacy Notice to create an account.');

  const created = nowIso();
  const user = {
    id: id('usr_'), email: normalized, email_verified_at: null, mfa_enabled_at: null,
    terms_version: config.termsVersion, terms_accepted_at: created, created_at: created,
  };
  try {
    const passwordHash = await hashPassword(password);
    db.prepare(`INSERT INTO users (id, email, password_hash, email_verified_at, mfa_enabled_at, terms_version, terms_accepted_at, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)`)
      .run(user.id, user.email, passwordHash, user.terms_version, user.terms_accepted_at, user.created_at);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('An account with that email already exists.');
    throw error;
  }
  return publicUser(user);
}

export async function authenticateUser(email, password) {
  const normalized = normalizeEmail(email);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (!row || !await verifyPassword(String(password || ''), row.password_hash)) throw new Error('Email or password is incorrect.');
  return publicUser(row);
}

export function createMfaLoginChallenge(userId) {
  db.prepare('DELETE FROM mfa_login_challenges WHERE user_id = ? OR expires_at <= ?').run(userId, nowIso());
  const token = `mfa_${b64(crypto.randomBytes(32))}`;
  const created = nowIso();
  const expires = new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60_000).toISOString();
  db.prepare(`INSERT INTO mfa_login_challenges (token_hash, user_id, expires_at, used_at, attempts, created_at)
    VALUES (?, ?, ?, NULL, 0, ?)`)
    .run(tokenHash(token, 'mfa-login'), userId, expires, created);
  return { challengeToken: token, expiresAt: expires };
}

export function completeMfaLogin(challengeToken, code) {
  const hash = tokenHash(String(challengeToken || ''), 'mfa-login');
  const row = db.prepare(`SELECT c.*, u.mfa_secret_encrypted, u.mfa_recovery_codes_json
    FROM mfa_login_challenges c JOIN users u ON u.id=c.user_id
    WHERE c.token_hash=? AND c.used_at IS NULL AND c.expires_at>?`).get(hash, nowIso());
  if (!row || row.attempts >= 8) throw new Error('The verification challenge is invalid or expired.');
  db.prepare('UPDATE mfa_login_challenges SET attempts=attempts+1 WHERE token_hash=?').run(hash);
  const accepted = verifyMfaCode(row.user_id, row.mfa_secret_encrypted, row.mfa_recovery_codes_json, code);
  if (!accepted) throw new Error('The authentication code is invalid.');
  db.prepare('UPDATE mfa_login_challenges SET used_at=? WHERE token_hash=?').run(nowIso(), hash);
  return row.user_id;
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

export async function resetPassword(token, password) {
  validatePassword(password);
  const row = db.prepare(`SELECT token_hash, user_id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`)
    .get(tokenHash(String(token || ''), 'password-reset'), nowIso());
  if (!row) throw new Error('This reset link is invalid or has expired.');
  const passwordHash = await hashPassword(password);
  const usedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(usedAt, row.token_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return row.user_id;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row || !await verifyPassword(String(currentPassword || ''), row.password_hash)) throw new Error('Current password is incorrect.');
  validatePassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function verifyUserPassword(userId, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  return Boolean(row && await verifyPassword(String(password || ''), row.password_hash));
}

export function createEmailVerification(userId) {
  const user = db.prepare('SELECT id, email, email_verified_at FROM users WHERE id=?').get(userId);
  if (!user || user.email_verified_at) return null;
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id=? OR expires_at<=?').run(userId, nowIso());
  const token = `verify_${b64(crypto.randomBytes(32))}`;
  const expires = new Date(Date.now() + config.emailVerificationHours * 3600000).toISOString();
  db.prepare('INSERT INTO email_verification_tokens (token_hash,user_id,expires_at,used_at,created_at) VALUES (?,?,?,NULL,?)')
    .run(tokenHash(token, 'email-verification'), userId, expires, nowIso());
  return { token, user, expires };
}

export function verifyEmailToken(token) {
  const hash = tokenHash(String(token || ''), 'email-verification');
  const row = db.prepare(`SELECT token_hash,user_id FROM email_verification_tokens
    WHERE token_hash=? AND used_at IS NULL AND expires_at>?`).get(hash, nowIso());
  if (!row) throw new Error('This verification link is invalid or expired.');
  const at = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(at, row.user_id);
    db.prepare('UPDATE email_verification_tokens SET used_at=? WHERE token_hash=?').run(at, hash);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return row.user_id;
}

export async function beginMfaSetup(userId, password) {
  if (!await verifyUserPassword(userId, password)) throw new Error('Password is incorrect.');
  const user = db.prepare('SELECT email,mfa_enabled_at FROM users WHERE id=?').get(userId);
  if (!user) throw new Error('Account not found.');
  if (user.mfa_enabled_at) throw new Error('Multi-factor authentication is already enabled.');
  const secret = base32Encode(crypto.randomBytes(20));
  return {
    secret,
    otpauthUri: `otpauth://totp/${encodeURIComponent(config.companyName)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(config.companyName)}&algorithm=SHA1&digits=6&period=30`,
  };
}

export async function enableMfa(userId, { password, secret, code }) {
  if (!await verifyUserPassword(userId, password)) throw new Error('Password is incorrect.');
  const cleanSecret = String(secret || '').replace(/\s+/g, '').toUpperCase();
  if (!verifyTotp(cleanSecret, code)) throw new Error('The authentication code is invalid.');
  const recoveryCodes = Array.from({ length: 10 }, () => `${randomCode(5)}-${randomCode(5)}`);
  const hashes = recoveryCodes.map((value) => tokenHash(value.toLowerCase(), 'mfa-recovery'));
  db.prepare(`UPDATE users SET mfa_secret_encrypted=?, mfa_enabled_at=?, mfa_recovery_codes_json=? WHERE id=?`)
    .run(encrypt(cleanSecret), nowIso(), JSON.stringify(hashes), userId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  return { recoveryCodes };
}

export async function disableMfa(userId, { password, code }) {
  if (!await verifyUserPassword(userId, password)) throw new Error('Password is incorrect.');
  const row = db.prepare('SELECT mfa_secret_encrypted,mfa_recovery_codes_json FROM users WHERE id=?').get(userId);
  if (!row?.mfa_secret_encrypted) throw new Error('Multi-factor authentication is not enabled.');
  if (!verifyMfaCode(userId, row.mfa_secret_encrypted, row.mfa_recovery_codes_json, code)) throw new Error('The authentication code is invalid.');
  db.prepare(`UPDATE users SET mfa_secret_encrypted=NULL,mfa_enabled_at=NULL,mfa_recovery_codes_json='[]' WHERE id=?`).run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

export async function reauthenticateSession(req, password, code = '') {
  const user = getUserFromRequest(req);
  if (!user || !await verifyUserPassword(user.id, password)) throw new Error('Password is incorrect.');
  if (user.mfaEnabled) {
    const row = db.prepare('SELECT mfa_secret_encrypted,mfa_recovery_codes_json FROM users WHERE id=?').get(user.id);
    if (!verifyMfaCode(user.id, row.mfa_secret_encrypted, row.mfa_recovery_codes_json, code)) throw new Error('The authentication code is invalid.');
  }
  db.prepare('UPDATE sessions SET authenticated_at=?,mfa_verified=? WHERE token_hash=?')
    .run(nowIso(), user.mfaEnabled ? 1 : 0, user._sessionTokenHash);
  return publicUser({ ...user, authenticated_at: nowIso(), mfa_verified: user.mfaEnabled ? 1 : 0 });
}

export function requireRecentAuthentication(user, maxMinutes = 30) {
  return Boolean(user?.authenticatedAt && Date.now() - Date.parse(user.authenticatedAt) <= maxMinutes * 60_000 && (!user.mfaEnabled || user.mfaVerified));
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    emailVerifiedAt: row.email_verified_at || null,
    mfaEnabled: Boolean(row.mfa_enabled_at),
    mfaVerified: Boolean(row.mfa_verified),
    authenticatedAt: row.authenticated_at || null,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    created_at: row.created_at,
  };
}

function verifyMfaCode(userId, encryptedSecret, recoveryJson, code) {
  const value = String(code || '').trim();
  if (/^\d{6}$/.test(value) && encryptedSecret && verifyTotp(decrypt(encryptedSecret), value)) return true;
  const recoveryHash = tokenHash(value.toLowerCase(), 'mfa-recovery');
  const hashes = parseJson(recoveryJson, []);
  const index = hashes.findIndex((hash) => safeEqual(hash, recoveryHash));
  if (index >= 0) {
    hashes.splice(index, 1);
    db.prepare('UPDATE users SET mfa_recovery_codes_json=? WHERE id=?').run(JSON.stringify(hashes), userId);
    return true;
  }
  return false;
}

function verifyTotp(secret, code, now = Date.now()) {
  try {
    const key = base32Decode(secret);
    for (let offset = -1; offset <= 1; offset += 1) {
      const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS) + offset;
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(counter));
      const digest = crypto.createHmac('sha1', key).update(buffer).digest();
      const index = digest[digest.length - 1] & 0x0f;
      const number = ((digest[index] & 0x7f) << 24) | (digest[index + 1] << 16) | (digest[index + 2] << 8) | digest[index + 3];
      const expected = String(number % 1_000_000).padStart(6, '0');
      if (safeEqual(expected, String(code))) return true;
    }
  } catch {}
  return false;
}

function encrypt(value) {
  const key = crypto.createHash('sha256').update(`mfa:${config.sessionSecret}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ciphertext)}`;
}

function decrypt(value) {
  const [iv64, tag64, data64] = String(value || '').split('.');
  const key = crypto.createHash('sha256').update(`mfa:${config.sessionSecret}`).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]).toString('utf8');
}

function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  let bits = 0, accumulator = 0;
  const bytes = [];
  for (const char of String(value || '').replace(/=+$/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    accumulator = (accumulator << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function randomCode(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
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
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) throw new Error('Password must include letters and a number.');
}

function safeEqual(a, b) {
  try {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch { return false; }
}

function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
