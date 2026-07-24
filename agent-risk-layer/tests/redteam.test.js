import test from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign, TEST_CATALOG, toSarif, verifyBundle } from '../redteam/agent-risk-redteam.mjs';
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
  assert.equal(TEST_CATALOG.length, 32);
  const bundle = await runCampaign({ authorised:true, environment:'test', profile:'hardened', trials:3 });
  assert.equal(bundle.summary.caseTotal, 32);
  assert.equal(bundle.summary.trialTotal, 96);
  assert.equal(bundle.summary.trialsPerCase, 3);
  assert.equal(bundle.summary.passRate, 100);
  assert.match(bundle.summary.confidenceStatement, /96 repeated trials/i);
  assert.ok(bundle.results.every((item) => item.trial >= 1 && item.trial <= 3));
});

test('staging adapter execution requires a Rules of Engagement identifier', async () => {
  await assert.rejects(
    () => runCampaign({ authorised:true, environment:'local', endpoint:'http://127.0.0.1:65534/agentrisklayer/evaluate' }),
    /authorisation-id/i,
  );
});
