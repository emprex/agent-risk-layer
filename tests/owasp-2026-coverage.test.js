import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OWASP_2026_COVERAGE_TARGETS
} from '../src/agent/controlled-assurance-baseline.mjs';

const root =
  fileURLToPath(new URL('../', import.meta.url));

const catalogue = fs.readFileSync(
  path.join(
    root,
    'risk-knowledge/risk-knowledge-v1.csv'
  ),
  'utf8'
);

function mappedCount(id) {
  return (
    catalogue.match(
      new RegExp(`\\b${id}\\b`, 'g')
    ) || []
  ).length;
}

test('ARL catalogue covers every OWASP Agentic Top 10 2026 category at least once', () => {
  for (
    const id of
    OWASP_2026_COVERAGE_TARGETS.agenticApplications
  ) {
    assert.ok(
      mappedCount(id) > 0,
      `Missing OWASP Agentic 2026 mapping for ${id}`
    );
  }
});

test('ARL catalogue covers every OWASP LLM Top 10 2026 category at least once', () => {
  for (
    const id of
    OWASP_2026_COVERAGE_TARGETS.llmApplications
  ) {
    assert.ok(
      mappedCount(id) > 0,
      `Missing OWASP LLM 2026 mapping for ${id}`
    );
  }
});

test('OWASP mappings remain technical coverage references rather than accreditation claims', () => {
  assert.doesNotMatch(
    catalogue,
    /OWASP[^\n]*(?:accredited|certified by OWASP)/i
  );
});
