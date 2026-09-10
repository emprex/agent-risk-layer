import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'phase4-hosted-integration-contract-secret-123456789';

const root = path.resolve(import.meta.dirname, '..');
const agentRoot = path.join(root, 'src', 'agent');

function agentModules(directory = agentRoot) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...agentModules(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files.sort();
}

function requestedBindings(fragment) {
  return fragment
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\.\.\./, '').split(':')[0].split('=')[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

test('Phase 4 hosted API loads against the canonical AgentRiskLayer authority', async () => {
  const hostedApi = await import('../src/agent/hosted-agent-api.mjs');
  const controlIntelligenceCore = await import('../src/control-intelligence-core.js');

  assert.equal(typeof hostedApi.handleHostedAgentApi, 'function');
  assert.equal(typeof controlIntelligenceCore.getDerivedDeploymentReadiness, 'function');

  const expectedPaths = [
    '/api/agent/assessment/prepare',
    '/api/agent/assessment/context',
    '/api/agent/assessment/applicability',
    '/api/agent/assessment/bounded-test/prepare',
    '/api/agent/assessment/bounded-test/complete',
    '/api/agent/assessment/continue',
    '/api/agent/assessment/remediation/prepare',
    '/api/agent/assessment/remediation/complete',
    '/api/agent/assessment/remediation/changed-snapshot',
    '/api/agent/assessment/remediation/applicability',
    '/api/agent/assessment/exact-retest/prepare',
    '/api/agent/assessment/exact-retest/complete'
  ];

  const exportedPaths = Object.entries(hostedApi)
    .filter(([name, value]) => name.endsWith('_PATH') && typeof value === 'string')
    .map(([, value]) => value);

  for (const endpoint of expectedPaths) {
    assert.ok(exportedPaths.includes(endpoint), `Missing hosted Phase 4 endpoint: ${endpoint}`);
  }
});

test('Phase 4 agent dynamic imports request exports that actually exist', async () => {
  const pattern = /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let checkedBindings = 0;

  for (const sourceFile of agentModules()) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const [, bindingFragment, specifier] = match;
      if (!specifier.startsWith('.')) continue;

      const targetPath = path.resolve(path.dirname(sourceFile), specifier);
      assert.ok(
        fs.existsSync(targetPath),
        `${path.relative(root, sourceFile)} dynamically imports missing module ${specifier}`
      );

      const namespace = await import(pathToFileURL(targetPath).href);
      for (const binding of requestedBindings(bindingFragment)) {
        checkedBindings += 1;
        assert.ok(
          Object.prototype.hasOwnProperty.call(namespace, binding),
          `${path.relative(root, sourceFile)} requests ${binding} from ${path.relative(root, targetPath)}, but that export does not exist`
        );
      }
    }
  }

  assert.ok(checkedBindings > 0, 'Expected to validate at least one Phase 4 dynamic import binding');
});

test('deployment readiness is bound to Control Intelligence core, never inferred by the agent', async () => {
  const source = fs.readFileSync(
    path.join(agentRoot, 'tools', 'get-deployment-readiness.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /import\(['"]\.\.\/\.\.\/control-intelligence-core\.js['"]\)/,
    'Hosted readiness must use the canonical Control Intelligence core authority'
  );
  assert.doesNotMatch(
    source,
    /import\(['"]\.\.\/\.\.\/control-intelligence\.js['"]\)[\s\S]*getDerivedDeploymentReadiness/,
    'The agent must not bind derived readiness through the wrong facade'
  );
});
