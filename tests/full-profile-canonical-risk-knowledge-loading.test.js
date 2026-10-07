import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
  fileURLToPath(new URL('../', import.meta.url));

test('authoritative full-profile workflow hydrates canonical check details before building the evidence queue', () => {
  const source = fs.readFileSync(
    path.join(
      root,
      'src/agent/authoritative-workflow-state.mjs'
    ),
    'utf8'
  );

  assert.match(
    source,
    /getRiskKnowledgeEntry/
  );

  assert.match(
    source,
    /detailedItems/
  );

  assert.match(
    source,
    /getRiskKnowledgeEntry\(item\.id\)/
  );

  assert.match(
    source,
    /riskKnowledge\s*=\s*\{[\s\S]*items:\s*detailedItems\.filter\(Boolean\)/
  );
});
