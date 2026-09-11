import http from 'node:http';

import { getUserFromRequest } from './auth.js';
import { config } from './config.js';
import {
  applySecurityHeaders,
  primaryRateLimitAllowed,
  verifyCsrf,
} from './security.js';

const originalCreateServer = http.createServer;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const HOSTED_AGENT_PREFIX = '/api/agent/assessment/';
const HOSTED_BOUNDED_ROE_PATH =
  '/api/agent/assessment/bounded-test/authorise';

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex =
    typeof args[0] === 'function' ? 0 :
      (typeof args[1] === 'function' ? 1 : -1);

  if (listenerIndex >= 0) {
    const originalListener = args[listenerIndex];
    args[listenerIndex] = async function hostedAgentApiRouter(req, res) {
      let pathname = '';
      try {
        pathname = new URL(req.url || '/', config.baseUrl).pathname;
      } catch {
        return originalListener.call(this, req, res);
      }

      if (!pathname.startsWith(HOSTED_AGENT_PREFIX)) {
        return originalListener.call(this, req, res);
      }

      applySecurityHeaders(res);

      try {
        if (!await primaryRateLimitAllowed(req, pathname)) {
          return reply(res, 429, {
            error: 'Too many requests. Please try again shortly.',
            code: 'HOSTED_AGENT_RATE_LIMITED',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        if (req.method !== 'POST') {
          return reply(res, 405, {
            error: 'Method not allowed.',
            code: 'HOSTED_AGENT_METHOD_NOT_ALLOWED',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        if (!verifyCsrf(req)) {
          return reply(res, 403, {
            error: 'Security token missing or invalid. Refresh the session and try again.',
            code: 'HOSTED_AGENT_CSRF_REQUIRED',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          return reply(res, 415, {
            error: 'JSON request required.',
            code: 'HOSTED_AGENT_JSON_REQUIRED',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        const operator = await getUserFromRequest(req);
        if (!operator?.id) {
          return reply(res, 401, {
            error: 'Sign in required.',
            code: 'HOSTED_OPERATOR_AUTHENTICATION_REQUIRED',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        const body = await readJson(req);
        let result;

        if (pathname === HOSTED_BOUNDED_ROE_PATH) {
          const { handleHostedBoundedRoeApi } =
            await import('./agent/hosted-bounded-roe-api.mjs');
          result = await handleHostedBoundedRoeApi({
            pathname,
            method: req.method,
            operator,
            body,
          });
        } else {
          const { handleHostedAgentApi } = await import('./agent/hosted-agent-api.mjs');
          result = await handleHostedAgentApi({
            pathname,
            method: req.method,
            operator,
            body,
          });
        }

        if (result?.handled !== true) {
          return reply(res, 404, {
            error: 'Hosted assessment route not found.',
            code: 'HOSTED_AGENT_ROUTE_NOT_FOUND',
            deploymentDecisionWritten: false,
            humanReviewRequired: true,
          });
        }

        return reply(res, Number(result.statusCode) || 500, result.body || {
          error: 'Hosted assessment returned no response.',
          code: 'HOSTED_AGENT_EMPTY_RESPONSE',
          deploymentDecisionWritten: false,
          humanReviewRequired: true,
        });
      } catch (error) {
        const statusCode = Number(error?.statusCode) || 500;
        if (statusCode >= 500) {
          console.error('Hosted agent API failed:', error?.message || error);
        }
        return reply(res, statusCode, {
          error: statusCode < 500
            ? String(error?.message || 'Hosted assessment request failed.')
            : 'Hosted assessment request failed.',
          code: error?.code || 'HOSTED_AGENT_API_FAILED',
          deploymentDecisionWritten: false,
          humanReviewRequired: true,
        });
      }
    };
  }

  return originalCreateServer.apply(this, args);
};

async function readJson(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Hosted assessment request is too large.');
      error.statusCode = 413;
      error.code = 'HOSTED_AGENT_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Invalid JSON request.');
    error.statusCode = 400;
    error.code = 'HOSTED_AGENT_JSON_INVALID';
    throw error;
  }
}

function reply(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
