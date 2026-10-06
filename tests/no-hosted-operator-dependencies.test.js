import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');

const retired = [
  'src/agent/hosted-applicability-confirmation.mjs',
  'src/agent/hosted-assessment-context.mjs',
  'src/agent/hosted-assessment-preparation.mjs',
  'src/agent/hosted-human-review.mjs',
  'src/agent/hosted-operator-context.mjs',
  'src/agent/hosted-remediation-handoff.mjs',
  'src/agent/hosted-workflow-conversation.mjs',
  'src/agent/operator-context-bootstrap.mjs',
  'src/agent/operator-session-auth.mjs',
  'src/agent/operator-session-cache.mjs'
];

test('retired hosted operator modules are absent from the canonical local product', () => {
  for (const relative of retired) {
    assert.equal(
      fs.existsSync(path.join(root, relative)),
      false,
      `${relative} must stay retired`
    );
  }
});

test('canonical local workflow has no remote operator session dependency', () => {
  const files = [
    'src/agent/arl-local-assessment-runner.mjs',
    'src/agent/local-assessment-workflow.mjs',
    'src/agent/local-assessment-context.mjs',
    'src/agent/local-self-proof.mjs'
  ];

  const source = files
    .map((relative) =>
      fs.readFileSync(
        path.join(root, relative),
        'utf8'
      )
    )
    .join('\n');

  assert.doesNotMatch(
    source,
    /ARL_SERVER_URL|ARL_OPERATOR_SESSION_TOKEN/
  );
  assert.doesNotMatch(
    source,
    /hosted-(?:assessment|operator|workflow|human|remediation|applicability)/
  );
});
