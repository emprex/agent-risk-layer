import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function json(relative) {
  return JSON.parse(read(relative));
}

function exportedVersion(relative, name) {
  const source = read(relative);
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`)
  );
  assert.ok(match, `${name} missing from ${relative}`);
  return match[1];
}

test('active ARL toolchain has one canonical version set', () => {
  const versions = json('ARL_TOOLCHAIN_VERSIONS.json');
  const published = json('public/downloads/arl-toolchain-release.json');
  const pkg = json('package.json');
  const inspectorRelease = json('public/downloads/inspector-release.json');
  const redTeamRelease = json('public/downloads/redteam-release.json');

  assert.deepEqual(published, versions);
  assert.equal(pkg.version, versions.product.version);

  const riskKnowledge = json(versions.controlCatalog.canonicalJson);
  const controlIds = riskKnowledge.entries.map((entry) => entry.id);
  const expectedIds = Array.from(
    { length: versions.controlCatalog.expectedCount },
    (_, index) => `ARL-KB-${String(index + 1).padStart(3, '0')}`
  );
  assert.equal(versions.controlCatalog.version, versions.controlIntelligence.controlProfile);
  assert.equal(versions.controlCatalog.firstId, expectedIds[0]);
  assert.equal(versions.controlCatalog.lastId, expectedIds.at(-1));
  assert.equal(riskKnowledge.asset.version, versions.controlCatalog.version);
  assert.deepEqual(controlIds, expectedIds);
  assert.deepEqual(
    [...new Set(riskKnowledge.entries.map((entry) => entry.knowledge_version))],
    [versions.controlCatalog.version],
    'all 108 active controls must use exactly the canonical control-set version'
  );

  assert.equal(
    exportedVersion('inspector/agent-risk-inspector.mjs', 'INSPECTOR_VERSION'),
    versions.inspector.version
  );
  const inspectorBuilder = read('scripts/build-inspector-release.mjs');
  assert.match(inspectorBuilder, /toolchain\?\.inspector\?\.version/);
  assert.doesNotMatch(inspectorBuilder, /version:'4\.1\.5'|INSPECTOR_VERSION = '4\.1\.5'/);

  assert.equal(
    exportedVersion('public/downloads/agent-risk-inspector.mjs', 'INSPECTOR_VERSION'),
    versions.inspector.version
  );
  assert.equal(inspectorRelease.version, versions.inspector.version);
  assert.equal(
    inspectorRelease.policyVersion,
    versions.inspector.policyVersion
  );

  assert.equal(
    exportedVersion('redteam/agent-risk-redteam.mjs', 'REDTEAM_VERSION'),
    versions.redTeam.version
  );
  assert.equal(
    exportedVersion('public/downloads/agent-risk-redteam.mjs', 'REDTEAM_VERSION'),
    versions.redTeam.version
  );
  assert.equal(redTeamRelease.version, versions.redTeam.version);
  assert.equal(
    redTeamRelease.policyVersion,
    versions.redTeam.policyVersion
  );

  assert.equal(
    exportedVersion('runtime/agent-risk-runtime.mjs', 'RUNTIME_VERSION'),
    versions.runtime.version
  );
  assert.equal(
    exportedVersion('public/downloads/agent-risk-runtime.mjs', 'RUNTIME_VERSION'),
    versions.runtime.version
  );

  assert.match(
    read('public/agent-capability-profile.js'),
    new RegExp(versions.controlIntelligence.capabilityProfile.replaceAll('.', '\\.'))
  );
  assert.match(
    read('src/control-suggestions.js'),
    new RegExp(versions.controlIntelligence.suggestionProfile.replaceAll('.', '\\.'))
  );
  assert.match(
    read('src/config.js'),
    new RegExp(versions.scoring.version.replaceAll('.', '\\.'))
  );

  assert.equal(fs.existsSync(path.join(root, 'RELEASE_MANIFEST.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'RELEASE_VALIDATION.json')), false);
});

test('active product files contain no retired version markers', () => {
  const activeFiles = [
    'package.json',
    'src/config.js',
    'inspector/agent-risk-inspector.mjs',
    'public/downloads/agent-risk-inspector.mjs',
    'public/downloads/inspector-release.json',
    'redteam/agent-risk-redteam.mjs',
    'public/downloads/agent-risk-redteam.mjs',
    'public/downloads/redteam-release.json',
    'runtime/agent-risk-runtime.mjs',
    'public/downloads/agent-risk-runtime.mjs',
    'public/agent-capability-profile.js',
    'scripts/verify-control-intelligence-browser.mjs',
    'docs/AGENT_CAPABILITY_PROFILE.md',
    'docs/CONTROL_INTELLIGENCE_GRAPH.md'
  ];
  const active = activeFiles.map(read).join('\n');

  for (const retired of [
    "INSPECTOR_VERSION = '4.1.0'",
    '"version": "10.0.1"',
    "REDTEAM_VERSION = '5.2.1'",
    "ARL-CAP-1.1.0",
    "ARL-SUGGEST-1.0.0"
  ]) {
    assert.equal(
      active.includes(retired),
      false,
      `Retired active version marker remains: ${retired}`
    );
  }
});
