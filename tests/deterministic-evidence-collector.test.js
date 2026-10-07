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
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'fixture']);

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
