// Public assessment-request delivery: secret stays server-side, never in site JavaScript.
// Stateless transport only; no CRM/customer database or assessment authority is exposed.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ALLOWED_ORIGINS = new Set([
  'https://agentrisklayer.com',
  'https://www.agentrisklayer.com',
  'https://agent-risk-layer-static.onrender.com'
]);
const KEYS = ['name', 'company', 'email', 'systemName', 'useCase', 'access', 'concern'];
const LIMITS = Object.freeze({
  name: 120, company: 160, email: 254, systemName: 160,
  useCase: 1800, access: 1800, concern: 1800
});
const BODY_LIMIT = 12 * 1024;
const HOUR_MS = 60 * 60 * 1000;

function respond(res, status, message, origin = '') {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin',
    ...(origin ? { 'access-control-allow-origin': origin } : {})
  });
  res.end(JSON.stringify({ message }));
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = {};
  for (const key of KEYS) {
    const value = input[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > LIMITS[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return null;
    if (['name', 'company', 'email', 'systemName'].includes(key) && /[\r\n]/.test(trimmed)) return null;
    data[key] = trimmed;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)) return null;
  return data;
}

async function readBody(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > BODY_LIMIT) throw new Error('too_large');
    parts.push(part);
  }
  const body = Buffer.concat(parts).toString('utf8');
  const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase().trim();
  if (type === 'application/json') return JSON.parse(body);
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(body));
  }
  throw new Error('unsupported_content_type');
}

function submissionText(data) {
  return [
    'New human-review assessment enquiry via agentrisklayer.com',
    '',
    'Name: ' + data.name,
    'Company: ' + data.company,
    'Reply email: ' + data.email,
    'System / agent: ' + data.systemName,
    '',
    'What does the agent do?',
    data.useCase,
    '',
    'What can it access or change?',
    data.access,
    '',
    'What should be assessed?',
    data.concern,
    '',
    'UNTRUSTED PUBLIC SUBMISSION: no automated assessment, approval or action.'
  ].join('\n');
}

export function createRequestServer({ env = process.env, deliver = fetch, now = Date.now } = {}) {
  const perIp = new Map();
  let globalWindow = 0;
  let globalCount = 0;

  return createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    const allowed = ALLOWED_ORIGINS.has(origin);
    if (req.url === '/health' && req.method === 'GET') {
      return respond(res, env.RESEND_API_KEY ? 200 : 503, env.RESEND_API_KEY ? 'ready' : 'not_configured');
    }
    if (req.url !== '/api/assessment-request') return respond(res, 404, 'Not found');
    if (req.method === 'OPTIONS') {
      if (!allowed) return respond(res, 403, 'Origin not allowed');
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        'access-control-max-age': '600',
        'vary': 'Origin'
      });
      return res.end();
    }
    if (req.method !== 'POST') return respond(res, 405, 'Method not allowed', allowed ? origin : '');
    if (!allowed) return respond(res, 403, 'Origin not allowed');
    if (!env.RESEND_API_KEY || !String(env.RESEND_API_KEY).startsWith('re_')) {
      return respond(res, 503, 'Submission temporarily unavailable', origin);
    }

    let input;
    try {
      input = await readBody(req);
    } catch {
      return respond(res, 400, 'Invalid or oversized request', origin);
    }
    if (input && typeof input.website === 'string' && input.website.trim()) {
      return respond(res, 202, 'Request received', origin);
    }
    const data = validate(input);
    if (!data) return respond(res, 400, 'Please check all required fields', origin);

    const current = now();
    if (current - globalWindow >= HOUR_MS) { globalWindow = current; globalCount = 0; perIp.clear(); }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const count = (perIp.get(ip) || 0);
    if (count >= 5 || globalCount >= 40) return respond(res, 429, 'Too many requests', origin);
    perIp.set(ip, count + 1);
    globalCount++;

    try {
      const upstream = await deliver('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'User-Agent': 'AgentRiskLayer-Public-Request/1.0'
        },
        body: JSON.stringify({
          from: 'AgentRiskLayer Requests <requests@agentrisklayer.com>',
          to: ['support@agentrisklayer.com'],
          reply_to: [data.email],
          subject: 'New assessment request — AgentRiskLayer',
          text: submissionText(data)
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!upstream.ok) {
        console.error('Resend submission rejected, HTTP status:', upstream.status);
        return respond(res, 502, 'Delivery not confirmed, please email support@agentrisklayer.com', origin);
      }
      return respond(res, 202, 'Request accepted. AgentRiskLayer will review the scope and reply by email.', origin);
    } catch {
      console.error('Resend submission failed');
      return respond(res, 502, 'Delivery not confirmed, please email support@agentrisklayer.com', origin);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createRequestServer().listen(port, '0.0.0.0', () => {
    console.log('Public request handler listening; configured:', !!process.env.RESEND_API_KEY);
  });
}
