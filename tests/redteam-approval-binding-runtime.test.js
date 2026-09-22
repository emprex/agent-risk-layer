import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  runCampaign
} from '../redteam/agent-risk-redteam.mjs';

async function withAdapter(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  try {
    return await run(
      `http://127.0.0.1:${address.port}/agentrisklayer/evaluate`
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) =>
        error ? reject(error) : resolve()
      )
    );
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(
          JSON.parse(
            Buffer.concat(chunks).toString('utf8')
          )
        );
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

test('RT-PI-008 requires all five target-observed approval-binding probes', async () => {
  const seen = [];

  const bundle = await withAdapter(
    async (req, res) => {
      const request = await readJson(req);
      seen.push(request.approvalBinding?.probe || null);
      send(res, {
        schema: 'arl.redteam.response.v1',
        output: 'Synthetic dry-run target observation.',
        toolCalls: [],
        memoryWrites: [],
        approvals: [],
        telemetry: {
          totalTokens: 0,
          iterations: 1,
          toolCalls: 0,
          stoppedByLimit: false
        },
        approvalBinding: {
          schema: 'arl.approval-binding.v1',
          probe: request.approvalBinding.probe,
          actual: request.approvalBinding.expected,
          targetObserved: true
        }
      });
    },
    (endpoint) =>
      runCampaign({
        authorised: true,
        environment: 'local',
        endpoint,
        authToken: 'test-token',
        authorisationId: 'roe_abcdef',
        caseIds: ['RT-PI-008'],
        trials: 1,
        adaptiveRounds: 1,
        mutate: false
      })
  );

  assert.deepEqual(seen, [
    'no-approval',
    'exact-approval',
    'changed-parameters',
    'expired-approval',
    'replay'
  ]);
  assert.equal(bundle.results.length, 1);
  assert.equal(bundle.results[0].outcome, 'passed');
  assert.equal(
    bundle.results[0].approvalBindingMatrix.complete,
    true
  );
});

test('RT-PI-008 stays inconclusive when the adapter does not expose target-observed binding evidence', async () => {
  const bundle = await withAdapter(
    async (req, res) => {
      await readJson(req);
      send(res, {
        schema: 'arl.redteam.response.v1',
        output: 'No target approval-binding evidence exposed.',
        toolCalls: [],
        memoryWrites: [],
        approvals: [],
        telemetry: {
          totalTokens: 0,
          iterations: 1,
          toolCalls: 0,
          stoppedByLimit: false
        }
      });
    },
    (endpoint) =>
      runCampaign({
        authorised: true,
        environment: 'local',
        endpoint,
        authToken: 'test-token',
        authorisationId: 'roe_abcdef',
        caseIds: ['RT-PI-008'],
        trials: 1,
        adaptiveRounds: 1,
        mutate: false
      })
  );

  assert.equal(bundle.results.length, 1);
  assert.equal(bundle.results[0].outcome, 'inconclusive');
  assert.equal(
    bundle.results[0].approvalBindingMatrix.complete,
    false
  );
});
