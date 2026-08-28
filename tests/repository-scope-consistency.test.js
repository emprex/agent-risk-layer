import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REPOSITORY_SCOPE_CLASSIFICATION,
  REPOSITORY_SCOPE_RULE_ID,
  detectRepositoryScopeConsistency,
} from '../inspector/repository-scope-consistency.mjs';

test('detects stale Expo operational configuration only when active Flutter and retired Expo are corroborated', () => {
  const result = detectRepositoryScopeConsistency({
    'README.md': [
      '# Example',
      '',
      'The production mobile client is Flutter and lives in `apps/mobile_flutter`.',
      'The former Expo / React Native implementation is retired.',
      '',
      '```bash',
      'cd apps/mobile_flutter',
      'cp .env.example .env',
      'EXPO_PUBLIC_API_URL=http://192.168.1.5:3000',
      'npm install',
      'npm start',
      '```',
    ].join('\n'),
    'apps/mobile_flutter/pubspec.yaml': 'name: example\ndependencies:\n  flutter:\n    sdk: flutter\n',
  });

  assert.equal(result.ruleId, REPOSITORY_SCOPE_RULE_ID);
  assert.equal(result.status, 'stale-active-scope-references-observed');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].classification, REPOSITORY_SCOPE_CLASSIFICATION);
  assert.equal(result.findings[0].severity, 'low');
  assert.equal(result.findings[0].evidence.retiredToolchain, 'Expo');
  assert.equal(result.findings[0].evidence.activeComponent, 'apps/mobile_flutter');
  assert.equal(result.findings[0].evidence.file, 'README.md');
  assert.equal(result.findings[0].evidence.line, 9);
  assert.match(result.findings[0].evidence.staleReference, /EXPO_PUBLIC_API_URL/);
});

test('retirement declarations by themselves do not create a noisy finding', () => {
  const result = detectRepositoryScopeConsistency({
    'README.md': [
      'The production mobile client is Flutter and lives in `apps/mobile_flutter`.',
      'The former Expo / React Native implementation is retired and kept only in Git history.',
      'Run `flutter run` from the production mobile directory.',
    ].join('\n'),
  });

  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'no-stale-active-scope-reference-observed');
});

test('a generic Expo mention without explicit retired/current corroboration is not a finding', () => {
  const result = detectRepositoryScopeConsistency({
    'README.md': 'This repository once experimented with Expo. See the architecture notes for background.',
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
  });

  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'insufficient-corroborating-scope-evidence');
});

test('explicit repository scope config can corroborate a stale retired path in an active script', () => {
  const result = detectRepositoryScopeConsistency({
    '.agentrisk.json': JSON.stringify({
      repositoryScope: {
        activeComponents: ['apps/mobile_flutter'],
        retiredComponents: ['apps/mobile'],
        activeToolchains: ['Flutter'],
        retiredToolchains: ['Expo'],
      },
    }),
    'scripts/build-mobile.mjs': "import { execFileSync } from 'node:child_process';\nexecFileSync('npm',['--prefix','apps/mobile','run','build:alpha']);\n",
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].confidence, 'high');
  assert.equal(result.findings[0].evidence.retiredComponent, 'apps/mobile');
  assert.equal(result.findings[0].evidence.activeComponent, 'apps/mobile_flutter');
});

test('historical/archive documentation does not become active deployment evidence', () => {
  const result = detectRepositoryScopeConsistency({
    '.agentrisk.json': JSON.stringify({
      repositoryScope: {
        activeComponents: ['apps/mobile_flutter'],
        retiredComponents: ['apps/mobile'],
      },
    }),
    'archive/old-deployment.md': 'cd apps/mobile\nnpm start\n',
  });

  assert.equal(result.findings.length, 0);
});
