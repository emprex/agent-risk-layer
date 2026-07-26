#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { compileRuntimePolicy, evaluateRuntimeAction } from '../src/runtime-policy.js';
import { inspectContent } from '../src/content-security.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.policy || !args.upstream) {
  console.log('Usage: node runtime/agent-risk-runtime.mjs --policy runtime-policy.json --upstream https://agent.internal --port 8787 [--audit runtime-audit.jsonl]');
  process.exit(args.help ? 0 : 2);
}

const policy = compileRuntimePolicy(JSON.parse(fs.readFileSync(args.policy, 'utf8')));
const upstream = new URL(args.upstream);
if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Upstream must be an HTTP(S) URL without embedded credentials.');
const port = integer(args.port, 1, 65535, 8787);
const auditPath = args.audit || 'runtime-audit.jsonl';

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, mode: policy.mode, policyVersion: policy.version });
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return send(res, 405, { error: 'Only action requests are accepted.' });
  try {
    const raw = await readBody(req, policy.maxArgumentBytes);
    const body = raw.length ? JSON.parse(raw) : {};
    const inputDecision = policy.inspectInput ? inspectContent({ direction: 'input', content: body.messages ?? body.prompt ?? body.input, requestId: req.headers['x-request-id'], maxBytes: policy.maxArgumentBytes }) : null;
    if (inputDecision) audit(inputDecision);
    if (inputDecision?.decision === 'deny' && policy.mode === 'enforce') return send(res, 403, { error: 'Input blocked by AgentRiskLayer content policy.', decision: inputDecision });
    const tool = req.headers['x-arl-tool-name'] || body.tool || body.name;
    const runtimeContext = body.runtimeContext || {};
    const decision = evaluateRuntimeAction({ tool, arguments: body.arguments ?? body.input ?? body, context: runtimeContext, requestId: req.headers['x-request-id'] }, policy);
    audit(decision);
    res.setHeader('x-agentrisk-decision', decision.decision);
    res.setHeader('x-agentrisk-request-id', decision.requestId);
    if (decision.decision === 'deny') return send(res, 403, { error: 'Action blocked by AgentRiskLayer runtime policy.', decision });

    const target = new URL(req.url, upstream);
    const headers = { ...req.headers, host: target.host, 'x-agentrisk-evaluated': 'true', 'x-agentrisk-request-id': decision.requestId };
    delete headers['content-length'];
    const response = await fetch(target, { method: req.method, headers, body: raw, redirect: 'manual', signal: AbortSignal.timeout(integer(args.timeout, 100, 120000, 15000)) });
    const responseRaw = Buffer.from(await response.arrayBuffer());
    if (responseRaw.length > policy.maxResponseBytes) throw new Error('Response exceeds inspection limit.');
    let responseContent = responseRaw.toString('utf8');
    try { responseContent = JSON.parse(responseContent); } catch {}
    const outputDecision = policy.inspectOutput ? inspectContent({ direction: 'output', content: responseContent, requestId: decision.requestId, maxBytes: policy.maxResponseBytes }) : null;
    if (outputDecision) audit(outputDecision);
    if (outputDecision?.decision === 'deny' && policy.mode === 'enforce') return send(res, 502, { error: 'Upstream response blocked by AgentRiskLayer content policy.', decision: outputDecision });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(responseRaw);
  } catch (error) {
    const failure = { schema: 'arl.runtime.event.v1', requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), decision: 'deny', observedDecision: 'evaluation-error', reasons: [{ ruleId: 'ARL-RUN-FAIL', severity: 'critical', message: 'Runtime evaluation failed safely.' }], evidence: { rawArgumentsRetained: false }, evaluationMs: 0 };
    audit(failure);
    return send(res, 403, { error: 'Action blocked because runtime evaluation failed.', decision: failure });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`AgentRiskLayer runtime gateway listening on http://127.0.0.1:${port}`));

function audit(event) { fs.appendFileSync(auditPath, `${JSON.stringify(event)}\n`, { mode: 0o600 }); }
function send(res, status, body) { const payload = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' }); res.end(payload); }
async function readBody(req, max) { const chunks=[]; let size=0; for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Request too large.'); chunks.push(chunk); } return Buffer.concat(chunks).toString('utf8'); }
function parseArgs(values) { const out={}; for (let i=0;i<values.length;i+=1) { const item=values[i]; if (item === '--help') out.help=true; else if (item.startsWith('--')) out[item.slice(2)] = values[++i]; } return out; }
function integer(value, min, max, fallback) { const number=Number(value); return Number.isFinite(number) ? Math.max(min,Math.min(max,Math.trunc(number))) : fallback; }
