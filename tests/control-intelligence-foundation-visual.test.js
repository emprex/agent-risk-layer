import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('deployment evidence foundation loads scoped responsive visual polish after workspace styles', () => {
  const html = read('public/control-intelligence.html');
  const css = read('public/control-intelligence-foundation.css');

  assert.match(html, /\/workspace-app\.css"><link rel="stylesheet" href="\/control-intelligence-foundation\.css">/);
  assert.match(css, /workspace-deployment-evidence-page #ciRoot \.ci-empty/);
  assert.match(css, /#snapshotArchitecture/);
  assert.match(css, /\.ci-capability-profile/);
  assert.match(css, /\.ci-check-grid label/);
  assert.match(css, /#snapshotEnvironment/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(css, /display:\s*none/);
});
