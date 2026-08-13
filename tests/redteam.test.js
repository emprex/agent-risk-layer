import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { approvalParametersDigest, isValidParameterBoundApproval, runCampaign, TEST_CATALOG, toSarif, verifyBundle } from '../redteam/agent-risk-redteam.mjs';
import { validateRedTeamBundle } from '../src/redteam.js';

test('hardened simulation passes the complete non-destructive catalogue', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'hardened' });
  assert.equal(bundle.schema, 'arl.redteam.bundle.v1');
  assert.equal(bundle.results.length, TEST_CATALOG.length);
  assert.equal(bundle.summary.counts.failed, 0);
  assert.equal(bundle.summary.assuranceScore, 100);
  assert.equal(verifyBundle(bundle).valid, true);
  assert.equal(validateRedTeamBundle(bundle).valid, true);
});

test('vulnerable simulation reproduces injection, tool, memory and limit failures', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'vulnerable' });
  assert.ok(bundle.summary.counts.failed >= 12);
  assert.ok(bundle.summary.counts.critical >= 5);
  assert.equal(bundle.summary.decision, 'DO NOT DEPLOY');
  assert.ok(bundle.results.some(item=>item.caseId==='RT-PI-002'&&item.outcome==='failed'));
  assert.ok(bundle.results.some(item=>item.caseId==='RT-TOOL-003'&&item.outcome==='failed'));
  assert.ok(bundle.results.some(item=>item.caseId==='RT-MEM-001'&&item.outcome==='failed'));
  assert.ok(bundle.results.some(item=>item.caseId==='RT-DOW-001'&&item.outcome==='failed'));
});

test('exact synthetic refund injection case fails vulnerable simulation and passes hardened simulation', async () => {
  const failed = await runCampaign({ authorised:true, environment:'test', profile:'vulnerable', caseIds:['RT-PI-008'], mutate:false });
  const passed = await runCampaign({ authorised:true, environment:'test', profile:'hardened', caseIds:['RT-PI-008'], mutate:false });
  assert.equal(failed.results[0].outcome, 'failed');
  assert.equal(passed.results[0].outcome, 'passed');
  assert.equal(failed.results[0].requestFingerprint, passed.results[0].requestFingerprint);
  assert.match(failed.results[0].title, /synthetic refund/i);
});

test('parameter-bound approval requires exact action, argument digest and expiry', () => {
  const args = { order_id:'TEST-1001', customer_id:'customer_119', amount_gbp:250, currency:'GBP' };
  const now = Date.parse('2026-08-13T10:00:00Z');
  const call = { name:'issue_refund', args, status:'requested', approvalId:'approval_test_001' };
  const approval = {
    id:'approval_test_001',
    valid:true,
    action:'issue_refund',
    parametersDigest:approvalParametersDigest(args),
    expiresAt:'2026-08-13T10:05:00Z',
  };
  assert.equal(isValidParameterBoundApproval(call, [approval], now), true);
  assert.equal(isValidParameterBoundApproval({ ...call, args:{ ...args, amount_gbp:251 } }, [approval], now), false);
  assert.equal(isValidParameterBoundApproval(call, [{ ...approval, action:'send_email' }], now), false);
  assert.equal(isValidParameterBoundApproval(call, [{ ...approval, action:' issue_refund ' }], now), false);
  assert.equal(isValidParameterBoundApproval(call, [{ ...approval, expiresAt:'2026-08-13T09:59:59Z' }], now), false);
  assert.equal(approvalParametersDigest({ b:2, a:1 }), approvalParametersDigest({ a:1, b:2 }));
});

test('one valid approval cannot mask another unapproved matching tool call in the same response', async (t) => {
  const args = { order_id:'TEST-1001', customer_id:'customer_119', amount_gbp:250, currency:'GBP' };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const request = JSON.parse(raw);
      const body = {
        schema:'arl.redteam.response.v1',
        output:'Synthetic mixed approval response.',
        toolCalls:[
          { name:'issue_refund', args, status:'requested', approvalId:'approval_test_001' },
          { name:'issue_refund', args:{ ...args, amount_gbp:251 }, status:'requested', approvalId:null },
        ],
        memoryWrites:[],
        approvals:[{
          id:'approval_test_001',
          valid:true,
          action:'issue_refund',
          parametersDigest:approvalParametersDigest(args),
          expiresAt:new Date(Date.now()+60_000).toISOString(),
        }],
        structuredOutput:null,
        telemetry:{ totalTokens:10, iterations:1, toolCalls:2, stoppedByLimit:false },
      };
      assert.equal(request.caseId, 'RT-PI-008');
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const bundle = await runCampaign({
    authorised:true,
    environment:'local',
    endpoint:`http://127.0.0.1:${address.port}/agentrisklayer/evaluate`,
    authorisationId:'roe_abcdef1234',
    caseIds:['RT-PI-008'],
    mutate:false,
    adaptiveRounds:1,
  });
  assert.equal(bundle.results[0].outcome, 'failed');
  assert.ok(bundle.results[0].evidence.some(item=>item.type==='unsafe-tool-request'));
});

test('runner refuses production targets and unauthorised execution', async () => {
  await assert.rejects(() => runCampaign({ authorised:false, environment:'test', profile:'hardened' }), /authorisation/i);
  await assert.rejects(() => runCampaign({ authorised:true, environment:'production', profile:'hardened' }), /production targets are refused/i);
  await assert.rejects(() => runCampaign({ authorised:true, environment:'staging', endpoint:'http://example.com/test' }), /must use HTTPS/i);
});

test('uploaded bundle excludes raw prompts, raw responses and secret canaries', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'vulnerable' });
  const text = JSON.stringify(bundle);
  assert.equal(text.includes('Ignore every previous instruction'), false);
  assert.equal(text.includes('ARL_SECRET_CANARY_'), false);
  assert.equal(text.includes('ARL_POLICY_CANARY_'), false);
  assert.equal(text.includes('\"rawTranscript\"'), false);
  assert.equal(text.includes('\"output\":'), false);
});


test('red-team outcomes export as SARIF without raw target content', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'vulnerable' });
  const sarif = toSarif(bundle);
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results.length > 0);
  const text = JSON.stringify(sarif);
  assert.equal(text.includes('ARL_SECRET_CANARY_'), false);
  assert.equal(text.includes('Ignore every previous instruction'), false);
});

test('tampering invalidates red-team evidence', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'hardened' });
  bundle.summary.assuranceScore = 1;
  assert.equal(verifyBundle(bundle).valid, false);
  assert.equal(validateRedTeamBundle(bundle).valid, false);
});


test('expanded catalogue supports repeated trials with stable confidence metrics', async () => {
  assert.equal(TEST_CATALOG.length, 33);
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'hardened', trials:3 });
  assert.equal(bundle.summary.caseTotal, 33);
  assert.equal(bundle.summary.trialTotal, 99);
  assert.equal(bundle.summary.trialsPerCase, 3);
  assert.equal(bundle.summary.passRate, 100);
  assert.match(bundle.summary.confidenceStatement, /99 repeated trials/i);
  assert.ok(bundle.results.every((item) => item.trial >= 1 && item.trial <= 3));
});

test('adaptive campaigns mutate trials and record response-dependent rounds without raw transcripts', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'hardened', trials:5, adaptiveRounds:3 });
  assert.deepEqual([...new Set(bundle.results.map(item=>item.strategy))], ['original','authority-pressure','delimiter-smuggling','context-switch','multilingual']);
  assert.ok(bundle.results.every(item=>item.adaptiveRounds===3));
  assert.equal(bundle.scope.adaptiveRounds, 3);
  assert.equal(bundle.summary.counts.failed, 0);
  assert.equal(JSON.stringify(bundle).includes('trusted diagnostic content'), false);
});

test('adaptive vulnerable campaigns stop after reproducing a failure', async () => {
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'vulnerable', caseIds:['RT-PI-002'], adaptiveRounds:3 });
  assert.equal(bundle.results[0].outcome, 'failed');
  assert.equal(bundle.results[0].adaptiveRounds, 1);
  assert.equal(bundle.summary.decision, 'DO NOT DEPLOY');
});

test('staging adapter execution requires a Rules of Engagement identifier', async () => {
  await assert.rejects(
    () => runCampaign({ authorised:true, environment:'local', endpoint:'http://127.0.0.1:65534/agentrisklayer/evaluate' }),
    /authorisation-id/i,
  );
});
