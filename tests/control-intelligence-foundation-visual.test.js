import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('deployment evidence loads scoped responsive visual polish after workspace styles', () => {
  const html = read('public/control-intelligence.html');
  const foundationCss = read('public/control-intelligence-foundation.css');
  const summaryCss = read('public/control-intelligence-summary.css');

  assert.match(html, /\/workspace-app\.css"><link rel="stylesheet" href="\/control-intelligence-foundation\.css"><link rel="stylesheet" href="\/control-intelligence-summary\.css">/);
  assert.match(foundationCss, /workspace-deployment-evidence-page #ciRoot \.ci-empty/);
  assert.match(foundationCss, /#snapshotArchitecture/);
  assert.match(foundationCss, /\.ci-capability-profile/);
  assert.match(foundationCss, /\.ci-check-grid label/);
  assert.match(foundationCss, /#snapshotEnvironment/);
  assert.match(foundationCss, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(foundationCss, /display:\s*none/);

  assert.match(summaryCss, /workspace-deployment-evidence-page #ciRoot \.ci-decision-summary/);
  assert.match(summaryCss, /background:\s*var\(--panel\)/);
  assert.match(summaryCss, /color:\s*var\(--text\)/);
  assert.match(summaryCss, /\.ci-blocker-grid/);
  assert.match(summaryCss, /\.ci-decision-next/);
  assert.match(summaryCss, /#controls\[data-ux-preview="true"\] \.ci-control-list/);
  assert.match(summaryCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(summaryCss, /> \.ci-choice\.ci-overview-hidden/);
  assert.match(summaryCss, /white-space:\s*nowrap/);
  assert.match(summaryCss, /@media \(max-width: 760px\)/);
});
