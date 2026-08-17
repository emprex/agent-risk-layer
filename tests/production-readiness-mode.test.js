import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function probe(extraEnv = {}, deleteKeys = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of deleteKeys) delete env[key];
  const script = `
    import { config, launchReadiness, assertSafeProductionConfig } from './src/config.js';
    const readiness = launchReadiness();
    let startupError = null;
    try { assertSafeProductionConfig(); } catch (error) { startupError = error.message; }
    console.log(JSON.stringify({ config: { nodeEnv: config.nodeEnv, productStage: config.productStage }, readiness, startupError }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('declared production stage fails closed when NODE_ENV is not production', () => {
  const result = probe({ NODE_ENV: 'development', PRODUCT_STAGE: 'production', DEMO_MODE: 'true' });
  const productionMode = result.readiness.checks.find((check) => check.key === 'production_mode');
  assert.equal(result.config.productStage, 'production');
  assert.equal(result.config.nodeEnv, 'development');
  assert.equal(productionMode.required, true);
  assert.equal(productionMode.ok, false);
  assert.equal(result.readiness.ready, false);
  assert.match(result.startupError || '', /NODE_ENV is production/);
});

test('non-production environments do not inherit a production product stage by default', () => {
  const result = probe({ NODE_ENV: 'test', DEMO_MODE: 'true' }, ['PRODUCT_STAGE']);
  const productionMode = result.readiness.checks.find((check) => check.key === 'production_mode');
  assert.equal(result.config.productStage, 'development');
  assert.equal(productionMode.required, false);
  assert.equal(result.startupError, null);
});

test('NODE_ENV production defaults product stage to production when PRODUCT_STAGE is omitted', () => {
  const result = probe({ NODE_ENV: 'production', DEMO_MODE: 'true' }, ['PRODUCT_STAGE']);
  assert.equal(result.config.productStage, 'production');
  assert.equal(result.config.nodeEnv, 'production');
  assert.equal(result.readiness.checks.find((check) => check.key === 'production_mode').required, true);
});
