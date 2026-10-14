import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  collectDeterministicEvidence
} from '../src/agent/deterministic-evidence-collector.mjs';

function git(cwd, args) {
  return execFileSync(
    'git',
    ['-C', cwd, ...args],
    { encoding: 'utf8' }
  ).trim();
}

// Disposable Git fixtures must not depend on a developer's commit-signing agent.
function commitFixture(cwd, message) {
  return git(cwd, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
}

test('typed deterministic collector emits bounded privacy-safe observations for target, architecture, tools, credentials, network and dependencies', () => {
  const root =
    fs.mkdtempSync(
      path.join(os.tmpdir(), 'arl-evidence-')
    );

  try {
    fs.mkdirSync(
      path.join(root, 'docs'),
      { recursive: true }
    );
    fs.mkdirSync(
      path.join(root, '.github/workflows'),
      { recursive: true }
    );

    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture-agent',
        dependencies: {
          '@modelcontextprotocol/sdk': '1.0.0',
          openai: '4.0.0'
        }
      })
    );

    fs.writeFileSync(
      path.join(root, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture-agent',
        lockfileVersion: 3,
        packages: {}
      })
    );

    fs.writeFileSync(
      path.join(root, 'docs/architecture.md'),
      '# Architecture\nAgent -> MCP tool -> https://api.example.test/v1'
    );

    fs.writeFileSync(
      path.join(root, 'docs/security-policy.md'),
      '# Security Policy\nHuman approval required for sensitive actions.'
    );

    fs.writeFileSync(
      path.join(root, 'agent.mjs'),
      [
        'const token = process.env.AGENT_TOKEN;',
        'const endpoint = "https://api.example.test/v1";',
        'const mcpTool = "filesystem-tool";'
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(root, '.github/workflows/ci.yml'),
      'name: ci\n'
    );

    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'ARL Test']);
    // Deliberately require signing locally: fixture commits must override it.
    git(root, ['config', 'commit.gpgsign', 'true']);
    git(root, ['add', '.']);
    commitFixture(root, 'fixture');

    const revision =
      git(root, ['rev-parse', 'HEAD']);

    const result =
      collectDeterministicEvidence({
        repositoryPath: root,
        frozen: {
          target: { revision },
          inspection: {
            subject: {
              projectName: 'fixture-agent',
              environment: 'staging',
              gitDirty: false
            },
            observedTechnologies: [
              'Node.js',
              'MCP'
            ],
            summary: {
              score: 80
            },
            scope: {
              sourceCoverage: {
                status: 'complete'
              }
            }
          }
        },
        requirements: [
          'ARL-KB-005 versioned architecture and trust-boundary model',
          'ARL-KB-007 observed model, MCP, plugin, API and other provider inventory',
          'ARL-KB-013 relevant source, proxy, DNS, firewall, allowlist or tool configuration governing outbound access',
          'ARL-KB-014 secret-store, environment, CI/CD and runtime references showing which credentials the assessed version can use',
          'ARL-KB-017 dependency and version inventory'
        ]
      });

    assert.equal(
      result.targetRevision,
      revision
    );

    assert.equal(
      result.requirementObservations.length,
      5
    );
    const inventory = result.requirementObservations.find(row =>
      row.collectors.includes('architecture_and_inventory')
    ).observations.architecture_and_inventory;
    assert.deepEqual(inventory.providerPackageCandidates, ['@modelcontextprotocol/sdk', 'openai']);
    assert.equal(inventory.externalDestinationObservationCount, 1);
    assert.equal(inventory.externalDestinationObservations.length, 1);
    assert.equal(inventory.dependencyCount, 2);
    const deps = result.requirementObservations.find(row =>
      row.collectors.includes('dependency_and_build')
    ).observations.dependency_and_build;
    assert.equal(deps.discoveryCoverage.completeTrackedAndTextScan, true);
    const config = result.requirementObservations.find(row =>
      row.collectors.includes('source_and_configuration')
    ).observations.source_and_configuration;
    assert.equal(config.discoveryCoverage.completeTrackedAndTextScan, true);
        assert.equal(inventory.trackedFileCount, 6);
    assert.deepEqual(inventory.discoveryCoverage, {
      totalTrackedFiles: 6,
      trackedFilesConsidered: 6,
      trackedFileScanCapped: false,
      textCandidatesWithinTrackedFileLimit: 6,
      textFilesAttempted: 6,
      textFilesReadable: 6,
      textFileScanCapped: false,
      completeTrackedAndTextScan: true
    });

    const encoded =
      JSON.stringify(result);

    assert.match(encoded, /architectureArtifacts/);
    assert.match(encoded, /mcpAndToolReferenceFiles/);
    assert.match(encoded, /credentialReferenceFiles/);
    assert.match(encoded, /externalDestinationObservations/);
    assert.match(encoded, /dependencyNames/);

    assert.doesNotMatch(
      encoded,
      /AGENT_TOKEN\s*=/
    );
    assert.doesNotMatch(
      encoded,
      /api\.example\.test/
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});

test('KB-011 discovery records bounded coverage rather than pretending all tracked assets were scanned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-kb011-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'ARL Test']);
    for (let n = 0; n < 510; n += 1) {
      fs.writeFileSync(path.join(root, 'asset-' + String(n).padStart(3, '0') + '.js'),
        'const placeholder = ' + n + ';\\n');
    }
    git(root, ['add', '.']);
    commitFixture(root, 'synthetic inventory');
    const revision = git(root, ['rev-parse', 'HEAD']);
    const data = collectDeterministicEvidence({
      repositoryPath: root,
      frozen: {target:{revision}, inspection:{subject:{environment:'test',gitDirty:false}}},
      requirements: [
        'ARL-KB-011 assessed system, exact version, environment and inventory scope',
        'Read-only discovery evidence identifying observable agents, models, prompts, tools, data stores, service identities, deployments and scheduled jobs in scope'
      ]
    });
    const inventory = data.requirementObservations.find(row =>
      row.collectors.includes('architecture_and_inventory')
    ).observations.architecture_and_inventory;
    assert.equal(inventory.trackedFileCount, 510);
    assert.deepEqual(inventory.discoveryCoverage, {
      totalTrackedFiles: 510,
      trackedFilesConsidered: 500,
      trackedFileScanCapped: true,
      textCandidatesWithinTrackedFileLimit: 500,
      textFilesAttempted: 300,
      textFilesReadable: 300,
      textFileScanCapped: true,
      completeTrackedAndTextScan: false
    });
    assert.equal(data.targetRevision, revision);
    assert.equal(JSON.parse(JSON.stringify(data)).targetRevision, revision);
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
});

test('KB-007 prioritizes Python executable files and discovers provider candidates from Python requirements',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-python-provider-'));
 try {
   git(root,['init']);
   git(root,['config','user.email','test@example.test']);
   git(root,['config','user.name','ARL Test']);
   const newline = String.fromCharCode(10);
   fs.writeFileSync(path.join(root,'requirements.txt'),
     ['openai>=1.0','anthropic==0.40','requests==2.0'].join(newline));
   fs.writeFileSync(path.join(root,'pyproject.toml'),
     ['[project]','dependencies = ["mcp>=1.0", "qdrant-client>=1.0"]'].join(newline));
   fs.writeFileSync(path.join(root,'service.py'),'import openai');
   for(let i=0;i<505;i++) fs.writeFileSync(path.join(root,'documentation-'+String(i).padStart(3,'0')+'.md'),'documentation');
   git(root,['add','.']);commitFixture(root,'Python MCP fixture');
   const revision=git(root,['rev-parse','HEAD']);
   const result=collectDeterministicEvidence({
     repositoryPath:root,frozen:{target:{revision},inspection:{subject:{gitDirty:false}}},
     requirements:['ARL-KB-007 observed model, MCP, plugin, API and other provider inventory']
   });
   const inv=result.requirementObservations[0].observations.architecture_and_inventory;
   assert.equal(inv.trackedFileCount,508);
   assert.equal(inv.discoveryCoverage.trackedFileScanCapped,true);
   assert.ok(inv.providerPackageCandidates.includes('openai'));
   assert.ok(inv.providerPackageCandidates.includes('anthropic'));
   assert.ok(inv.providerPackageCandidates.includes('mcp'));
   // The same manifest must remain visible when executable sources exceed the file cap.
   for (let i=0;i<520;i++) fs.writeFileSync(path.join(root,'source-'+String(i).padStart(3,'0')+'.py'),'# code');
   git(root,['add','.']);commitFixture(root,'more Python executable sources');
   const rev2=git(root,['rev-parse','HEAD']);
   const more=collectDeterministicEvidence({
     repositoryPath:root,frozen:{target:{revision:rev2},inspection:{subject:{gitDirty:false}}},
     requirements:['ARL-KB-007 observed model, MCP, plugin, API and other provider inventory']
   });
   const inv2=more.requirementObservations[0].observations.architecture_and_inventory;
   assert.ok(inv2.providerPackageCandidates.includes('mcp'));
   assert.ok(inv2.providerPackageCandidates.includes('anthropic'));
   assert.equal(inv2.discoveryCoverage.trackedFileScanCapped,true);
   assert.ok(inv.providerPackageCandidates.includes('qdrant-client'));
   assert.ok(!inv.providerPackageCandidates.includes('requests'));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('KB-017 reports incomplete discovery coverage instead of implying a complete bill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-kb017-coverage-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'ARL Test']);
    fs.writeFileSync(path.join(root, 'package.json'),
      JSON.stringify({ name: 'bounded-agent', dependencies: { openai: '1.0.0' } }));
    for (let i = 0; i < 510; i++) {
      fs.writeFileSync(path.join(root, 'source-' + String(i).padStart(3, '0') + '.js'),
        'const value = ' + i + ';');
    }
    git(root, ['add', '.']);
    commitFixture(root, 'fixture');
    const revision = git(root, ['rev-parse', 'HEAD']);
    const result = collectDeterministicEvidence({
      repositoryPath: root,
      frozen: { target: { revision }, inspection: { subject: { environment: 'test' } } },
      requirements: [
        'ARL-KB-017 dependency and version inventory',
        'ARL-KB-017 control configuration or source location showing the dependency provenance boundary'
      ]
    });
    const rows = result.requirementObservations;
    const dep = rows[0].observations.dependency_and_build;
    const source = rows[1].observations.source_and_configuration;
    assert.equal(dep.dependencyCount, 1);
    for (const view of [dep, source]) {
      assert.equal(view.discoveryCoverage.totalTrackedFiles, 511);
      assert.equal(view.discoveryCoverage.trackedFileScanCapped, true);
      assert.equal(view.discoveryCoverage.textFileScanCapped, true);
      assert.equal(view.discoveryCoverage.completeTrackedAndTextScan, false);
    }
    assert.doesNotMatch(JSON.stringify(result), /source-000\\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('KB-017 discovers late dependency manifests outside generic 500-file source scan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-kb017-late-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'ARL Test']);
    for (let i = 0; i < 510; i++) {
      fs.writeFileSync(path.join(root, 'source-' + String(i).padStart(3, '0') + '.js'), 'const marker = 1;');
    }
    fs.mkdirSync(path.join(root, 'zz-late'));
    fs.writeFileSync(path.join(root, 'zz-late/package.json'),
      JSON.stringify({ name: 'late', dependencies: { 'late-agent-sdk': '1.2.3' } }));
    fs.writeFileSync(path.join(root, 'zz-late/package-lock.json'),
      JSON.stringify({ name: 'late', lockfileVersion: 3, packages: {} }));
    git(root, ['add', '.']);
    commitFixture(root, 'late dependency files');
    const revision = git(root, ['rev-parse', 'HEAD']);
    const collection = collectDeterministicEvidence({
      repositoryPath: root,
      frozen: { target: { revision }, inspection: { subject: { gitDirty: false } } },
      requirements: ['ARL-KB-017 dependency and version inventory']
    });
    const dependency = collection.requirementObservations[0].observations.dependency_and_build;
    assert.equal(dependency.discoveryCoverage.trackedFileScanCapped, true);
    assert.equal(dependency.dependencyCount, 1);
    assert.deepEqual(dependency.dependencyNames, ['late-agent-sdk']);
    assert.equal(dependency.lockfiles.length, 1);
    assert.equal(dependency.dependencyPathDiscovery.trackedTreeComplete, true);
    assert.equal(dependency.dependencyPathDiscovery.candidatePaths, 2);
    assert.equal(dependency.dependencyPathDiscovery.manifestsBeyondReadLimit, false);
    assert.equal(JSON.stringify(collection).includes('zz-late/package.json'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('KB-017 scans all 65 Python manifests and reports unreadable files separately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-kb017-python-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'ARL Test']);
    for (let i = 0; i < 65; i++) {
      const dir = path.join(root, 'pkg-' + String(i).padStart(3, '0'));
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'requirements.txt'),
        i === 64 ? 'openai==1.0.0\n' : 'requests==2.0.0\n');
    }
    git(root, ['add', '.']);
    commitFixture(root, '65 Python manifests');
    const revision = git(root, ['rev-parse', 'HEAD']);
    const result = collectDeterministicEvidence({
      repositoryPath: root,
      frozen: {target: {revision}, inspection: {subject: {gitDirty: false}}},
      requirements: ['ARL-KB-017 dependency and version inventory']
    });
    const dependency = result.requirementObservations[0].observations.dependency_and_build;
    assert.equal(dependency.dependencyPathDiscovery.pythonManifestsFound, 65);
    assert.equal(dependency.dependencyPathDiscovery.pythonManifestsReadable, 65);
    assert.equal(dependency.dependencyPathDiscovery.pythonManifestsUnreadable, 0);
    assert.equal(dependency.dependencyPathDiscovery.completeManifestRead, true);
    assert.equal(dependency.dependencyPathDiscovery.manifestsBeyondReadLimit, false);
    assert.equal(dependency.lockfiles.length, 20);
    assert.ok(!JSON.stringify(result).includes('pkg-064/requirements.txt'));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('KB-017 binds Python and npm declared and locked metadata to hashed file evidence', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-kb017-bill-'));
  try {
    git(root,['init']);
    git(root,['config','user.email','test@example.test']);
    git(root,['config','user.name','ARL Test']);
    fs.writeFileSync(path.join(root,'pyproject.toml'),
      '[project]\ndependencies = ["openai>=1.58.0", "httpx==0.28.1"]\n');
    fs.writeFileSync(path.join(root,'uv.lock'),
      'version = 1\n[[package]]\nname = "openai"\nversion = "1.58.1"\n[[package]]\nname = "httpx"\nversion = "0.28.1"\n');
    fs.writeFileSync(path.join(root,'requirements-dev.txt'),'anthropic==0.47.0\n--index-url https://token:secret@example.invalid/simple\n');
    fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({
      name:'fixture-agent',dependencies:{'@modelcontextprotocol/sdk':'^1.0.0'}
    }));
    fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({
      lockfileVersion:3,packages:{'':{},'node_modules/@modelcontextprotocol/sdk':{version:'1.1.0'}}
    }));
    git(root,['add','.']);commitFixture(root,'inert version metadata');
    const revision=git(root,['rev-parse','HEAD']);
    const result=collectDeterministicEvidence({
      repositoryPath:root,
      frozen:{target:{revision},inspection:{subject:{gitDirty:false}}},
      requirements:['ARL-KB-017 dependency and version inventory']
    });
    const dep=result.requirementObservations[0].observations.dependency_and_build;
    const inventory=dep.dependencyInventory;
    assert.equal(inventory.parserStatus,'completed');
    assert.equal(inventory.sourceCandidates,5, 'tracked files: '+git(root,['ls-files']));
    assert.equal(inventory.parsed.filesParsed,5);
    assert.equal(inventory.parsed.filesInvalid,0);
    assert.ok(inventory.parsed.declaredCount>=4, JSON.stringify(inventory.parsed.components));
    assert.ok(inventory.parsed.lockedCount>=3);
    assert.ok(inventory.parsed.components.some(p=>p.kind==='locked'&&p.name==='openai'&&p.versionOrConstraint==='1.58.1'));
    assert.ok(inventory.parsed.components.some(p=>p.kind==='declared'&&p.name==='anthropic'&&p.versionOrConstraint==='==0.47.0'));
    assert.ok(inventory.parsed.components.some(p=>p.kind==='locked'&&p.name==='@modelcontextprotocol/sdk'));
    assert.equal(inventory.buildArtifactVerified,false);
    assert.equal(inventory.modelProvenanceVerified,false);
    assert.equal(inventory.sbomComplete,false);
    // The legacy lockfile-ref family also classifies requirements*.txt as candidates.
    assert.equal(dep.lockfiles.length,3);
    assert.ok(!JSON.stringify(result).includes('https://token:secret@'));
    assert.ok(!JSON.stringify(result).includes(root));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('KB-017 discloses unsupported lockfile formats and never claims complete SBOM', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-kb017-unsupported-'));
  try {
    git(root,['init']);
    git(root,['config','user.email','test@example.test']);
    git(root,['config','user.name','ARL Test']);
    fs.writeFileSync(path.join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');
    fs.writeFileSync(path.join(root,'pyproject.toml'),'[broken\n');
    git(root,['add','.']);commitFixture(root,'unparsed lock');
    const revision=git(root,['rev-parse','HEAD']);
    const result=collectDeterministicEvidence({
      repositoryPath:root,
      frozen:{target:{revision},inspection:{subject:{gitDirty:false}}},
      requirements:['ARL-KB-017 dependency and version inventory']
    });
    const inv=result.requirementObservations[0].observations.dependency_and_build.dependencyInventory;
    assert.equal(inv.parserStatus,'completed');
    assert.equal(inv.parsed.filesUnsupported,1);
    assert.equal(inv.parsed.filesInvalid,1);
    assert.equal(inv.sbomComplete,false);
    assert.equal(inv.deployedArtifactVerified,false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
