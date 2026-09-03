import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildEvidencePlan, boundedCheckForGap } from '../public/evidence-plan.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const assessment = (gaps) => ({ result: { blockingEvidenceGaps: gaps } });

test('evidence plan requires source evidence before selecting runtime checks', () => {
  const plan = buildEvidencePlan({
    assessment: assessment([{ name: 'Tool security', status: 'evidence-required' }]),
    inspections: [],
  });
  assert.equal(plan.state, 'source-required');
  assert.equal(plan.checks.length, 0);
  assert.match(plan.explanation, /declaration is not proof/i);
});

test('after source evidence only mapped material gaps become bounded checks', () => {
  const plan = buildEvidencePlan({
    assessment: assessment([
      { name: 'Tool security', status: 'evidence-required' },
      { name: 'Human approval', status: 'evidence-required' },
      { name: 'Governance ownership record', status: 'evidence-required' },
    ]),
    inspections: [{ id: 'scan-1', createdAt: '2026-09-03T16:00:00Z' }],
  });
  assert.equal(plan.state, 'bounded-check-required');
  assert.deepEqual(plan.checks.map((item) => item.id), ['mcp-authority', 'approval-binding']);
  assert.equal(plan.manual.length, 1);
  assert.equal(plan.checks[0].caseId, 'RT-AUTH-001');
  assert.equal(plan.checks[1].caseId, 'RT-PI-008');
});

test('duplicate gaps do not create duplicate runtime work', () => {
  const plan = buildEvidencePlan({
    assessment: assessment([
      { name: 'MCP tool policy', status: 'evidence-required' },
      { name: 'Tool allowlist', status: 'evidence-required' },
    ]),
    inspections: [{ id: 'scan-1' }],
  });
  assert.equal(plan.checks.length, 1);
  assert.equal(plan.checks[0].id, 'mcp-authority');
});

test('unmapped evidence gap remains a gap instead of inventing a generic attack', () => {
  const plan = buildEvidencePlan({
    assessment: assessment([{ name: 'Named accountable owner', status: 'evidence-required' }]),
    inspections: [{ id: 'scan-1' }],
  });
  assert.equal(plan.state, 'manual-evidence-required');
  assert.equal(plan.checks.length, 0);
  assert.equal(plan.manual.length, 1);
  assert.match(plan.explanation, /do not invent a finding or run a generic attack suite/i);
});

test('bounded check catalogue uses existing controlled-test cases where a safe starting probe exists', () => {
  assert.equal(boundedCheckForGap({ name: 'Memory isolation' }).caseId, 'RT-MEM-002');
  assert.equal(boundedCheckForGap({ name: 'Outbound network policy' }).caseId, 'RT-TOOL-004');
  assert.equal(boundedCheckForGap({ name: 'Kill switch recovery' }).caseId, undefined);
});

test('Inspector renders the evidence plan and routes selected checks into controlled testing', () => {
  const html = read('public/inspector.html');
  const ui = read('public/inspector-evidence-plan.js');
  assert.match(html, /inspector-evidence-plan\.js/);
  assert.match(ui, /Evidence plan/);
  assert.match(ui, /Run only what is needed/);
  assert.match(ui, /No safe automatic bounded test selected/);
  assert.match(ui, /redteam\.html/);
  assert.match(ui, /Existing controlled-test case/);
});
