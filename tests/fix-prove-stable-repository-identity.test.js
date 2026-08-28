import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function runCase(root, readme) {
  fs.writeFileSync(path.join(root, 'README.md'), readme);

  const input = path.join(root, 'case.json');
  fs.writeFileSync(input, JSON.stringify({
    repositoryRoot: '.',
    currentSnapshot: 'current',
    priorFindings: [],
    currentFindings: [],
  }));

  const output = execFileSync(
    process.execPath,
    [path.resolve('scripts/build-fix-prove-evidence.mjs'), input],
    { encoding: 'utf8' },
  );

  return JSON.parse(output).PROVE.findingComparison
    .filter((item) => item.ruleId === 'ARL-REPO-003')
    .map((item) => item.findingIdentity)
    .sort();
}

test('repository-scope finding identities remain stable when finding order changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-repo-id-'));

  try {
    fs.writeFileSync(path.join(root, '.agentrisk.json'), JSON.stringify({
      repositoryScope: {
        activeComponents: ['apps/mobile_flutter'],
        retiredComponents: ['apps/mobile', 'apps/legacy'],
        activeToolchains: ['Flutter'],
        retiredToolchains: ['Expo'],
      },
    }));

    const first = runCase(root, [
      '# Deployment',
      'Production uses Flutter in `apps/mobile_flutter`.',
      'The former Expo implementation is retired.',
      'The legacy `apps/mobile` component is retired.',
      'The legacy `apps/legacy` component is retired.',
      'Run npm --prefix apps/mobile start',
      'Run npm --prefix apps/legacy start',
    ].join('\n'));

    const second = runCase(root, [
      '# Deployment',
      'Production uses Flutter in `apps/mobile_flutter`.',
      'The former Expo implementation is retired.',
      'The legacy `apps/legacy` component is retired.',
      'The legacy `apps/mobile` component is retired.',
      'Run npm --prefix apps/legacy start',
      'Run npm --prefix apps/mobile start',
    ].join('\n'));

    assert.ok(first.length >= 2);
    assert.deepEqual(second, first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
