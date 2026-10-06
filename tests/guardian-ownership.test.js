import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Guardian has one canonical owner and one active public release', () => {
  const canonical = JSON.parse(read('ARL_TOOLCHAIN_VERSIONS.json')).guardian;
  const published = JSON.parse(read('public/downloads/arl-toolchain-release.json')).guardian;

  assert.deepEqual(published, canonical);
  assert.equal(canonical.canonicalRepository, 'emprex/agent-risk-layer');
  assert.equal(canonical.version, '0.3.0');
  assert.equal(canonical.activeRelease, '0.3.0-rc.5');
  assert.equal(canonical.sourceStatus, 'release-artifact-only');

  const artifactPath = path.join(root, canonical.activeArtifact);
  const sidecarPath = path.join(root, canonical.digestSidecar);
  assert.equal(fs.existsSync(artifactPath), true);
  assert.equal(fs.existsSync(sidecarPath), true);

  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(artifactPath))
    .digest('hex');
  const declared = read(canonical.digestSidecar).trim().split(/\s+/)[0];

  assert.equal(actual, declared);
});

test('Guardian public page advertises only the active RC and preserves authority boundary', () => {
  const html = read('public/guardian.html');

  assert.match(html, /agentrisklayer-guardian-0\.3\.0-rc\.5\.tgz/);
  assert.doesNotMatch(html, /agentrisklayer-guardian-0\.3\.0-rc\.(?:2|3|4)\.tgz/);
  assert.match(html, /No LLM/);
  assert.match(html, /Guardian discovers\. AgentRiskLayer assesses\./);
  assert.match(html, /human review/i);
});

test('Guardian ownership document makes source recovery a prerequisite for the next release', () => {
  const ownership = read('GUARDIAN_OWNERSHIP.md');

  assert.match(ownership, /canonical owner is the AgentRiskLayer repository/i);
  assert.match(ownership, /does not contain a separately maintained Guardian source tree/i);
  assert.match(ownership, /No new Guardian version or release candidate should be published until/i);
  assert.match(ownership, /reproducible packaging step/i);
});
