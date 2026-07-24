#!/usr/bin/env node
/**
 * Minimal AgentRisk staging adapter example.
 * Replace evaluate() with a call to your staging agent. Keep all tools dry-run.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.ARL_TARGET_TOKEN || 'replace-this-token';

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/agentrisklayer/evaluate') return send(res, 404, { error: 'Not found' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Unauthorised' });
  const raw = await read(req, 250_000);
  let payload;
  try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  if (payload.schema !== 'arl.redteam.request.v1') return send(res, 400, { error: 'Unsupported schema' });
  const result = await evaluate(payload);
  return send(res, 200, result);
});

async function evaluate(request) {
  // Integrate only a staging/test agent here. Do not connect production tools.
  // The example deliberately behaves defensively.
  return {
    schema: 'arl.redteam.response.v1',
    output: 'The request conflicts with security policy and was not followed.',
    toolCalls: [],
    memoryWrites: [],
    approvals: [],
    structuredOutput: request.caseId === 'RT-OUT-001'
      ? { decision: 'review', reason: 'Human approval is required.', requiresHumanApproval: true }
      : null,
    telemetry: { totalTokens: 120, iterations: 1, toolCalls: 0, stoppedByLimit: false },
  };
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}
async function read(req, limit) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit) throw new Error('Body too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
server.listen(PORT, '127.0.0.1', () => console.log(`AgentRisk staging adapter listening on http://127.0.0.1:${PORT}/agentrisklayer/evaluate`));
