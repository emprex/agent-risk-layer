import http from 'node:http';
import { config } from './config.js';
import { sendOperationalAlert } from './email.js';

const originalCreateServer = http.createServer;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_BODY_BYTES = 32 * 1024;
const attempts = new Map();

http.createServer = function patchedCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : (typeof args[1] === 'function' ? 1 : -1);
    if (listenerIndex >= 0) {
        const originalListener = args[listenerIndex];
        args[listenerIndex] = async function assessmentRequestRouter(req, res) {
            let pathname = '';
            try {
                pathname = new URL(req.url || '/', config.baseUrl).pathname;
            } catch {
                return originalListener.call(this, req, res);
            }

            if (req.method !== 'POST' || pathname !== '/api/assessment-request') {
                return originalListener.call(this, req, res);
            }

            try {
                if (!sameOrigin(req)) {
                    return reply(res, 403, { error: 'Request origin is not allowed.' });
                }
                if (!allowRequest(clientAddress(req))) {
                    return reply(res, 429, { error: 'Too many requests. Please try again later.' });
                }
                if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
                    return reply(res, 415, { error: 'JSON request required.' });
                }

                const body = await readJson(req);
                const request = validate(body);
                const message = [
                    `Name: ${request.name}`,
                    `Company: ${request.company}`,
                    `Work email: ${request.email}`,
                    `Agent/system: ${request.systemName}`,
                    `Stage: ${request.stage}`,
                    `Repository: ${request.repository || 'Not provided'}`,
                    '',
                    'What the agent does:',
                    request.useCase,
                    '',
                    'Systems, tools or data it can access:',
                    request.access,
                    '',
                    'Assessment goal / why now:',
                    request.concern,
                    '',
                    'Submitted from the public AgentRiskLayer assessment request form.'
                ].join('\n');

                const delivery = await sendOperationalAlert({
                    to: config.supportEmail || 'support@agentrisklayer.com',
                    subject: `New AI Agent Security Assessment request — ${request.company || request.systemName}`,
                    message,
                });

                if (delivery?.simulated) {
                    return reply(res, 503, { error: 'Email delivery is not configured.' });
                }

                return reply(res, 202, { ok: true, message: 'Request received.' });
            } catch (error) {
                const status = Number(error?.statusCode) || 500;
                const message = status < 500 ? String(error.message) : 'We could not send your request. Please try again shortly.';
                if (status >= 500) console.error('Assessment request delivery failed:', error?.message || error);
                return reply(res, status, { error: message });
            }
        };
    }
    return originalCreateServer.apply(this, args);
};

function sameOrigin(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return true;
    try {
        return new URL(origin).origin === new URL(config.baseUrl).origin;
    } catch {
        return false;
    }
}

function clientAddress(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket?.remoteAddress || 'unknown';
}

function allowRequest(key) {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS) {
        attempts.set(key, recent);
        return false;
    }
    recent.push(now);
    attempts.set(key, recent);
    return true;
}

async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error('Request is too large.');
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        const error = new Error('Invalid JSON request.');
        error.statusCode = 400;
        throw error;
    }
}

function validate(body) {
    const field = (name, max) => String(body?.[name] || '').trim().slice(0, max);
    const request = {
        name: field('name', 120),
        company: field('company', 160),
        email: field('email', 254).toLowerCase(),
        systemName: field('systemName', 160),
        stage: field('stage', 40),
        repository: field('repository', 500),
        useCase: field('useCase', 2000),
        access: field('access', 2000),
        concern: field('concern', 2000),
    };
    const required = ['name', 'company', 'email', 'systemName', 'stage', 'useCase', 'access', 'concern'];
    if (required.some((name) => !request[name])) {
        const error = new Error('Please complete all required fields.');
        error.statusCode = 400;
        throw error;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)) {
        const error = new Error('Please enter a valid work email.');
        error.statusCode = 400;
        throw error;
    }
    if (!['Prototype', 'Pre-production', 'Production'].includes(request.stage)) {
        const error = new Error('Please select a valid system stage.');
        error.statusCode = 400;
        throw error;
    }
    return request;
}

function reply(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}
