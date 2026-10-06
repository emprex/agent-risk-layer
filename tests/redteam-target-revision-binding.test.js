import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  runCampaign
} from '../redteam/agent-risk-redteam.mjs';

test('Red Team binds adapter request and signed campaign target to frozen revision', async (t) => {
  const expectedRevision = '1'.repeat(40);
  let observedRevision = null;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    observedRevision = body.targetRevision || null;

    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      schema:'arl.redteam.response.v1',
      output:'Denied before dispatch.',
      toolCalls:[{
        name:'http_fetch',
        args:{},
        status:'denied',
        approvalId:null
      }],
      memoryWrites:[],
      approvals:[],
      structuredOutput:null,
      telemetry:{
        totalTokens:0,
        iterations:1,
        toolCalls:0,
        stoppedByLimit:false
      },
      executionStatus:'complete'
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const port = server.address().port;
  const bundle = await runCampaign({
    authorised:true,
    environment:'local',
    endpoint:`http://127.0.0.1:${port}/agentrisklayer/evaluate`,
    authToken:'test-token',
    authorisationId:'roe_abcdef1234',
    caseIds:['RT-TOOL-004'],
    trials:1,
    adaptiveRounds:1,
    mutate:false,
    targetRevision:expectedRevision
  });

  assert.equal(observedRevision, expectedRevision);
  assert.equal(bundle.campaign.target.revision, expectedRevision);
});

test('target-specific mcp-agent adapter rejects missing or stale target revision', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(
    new URL('../redteam/mcp-agent-local-adapter.py', import.meta.url),
    'utf8'
  );

  assert.match(source, /target_revision_required/);
  assert.match(source, /target_revision_mismatch/);
  assert.match(source, /requested_revision != REVISION/);
});
