import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPENDENCY_COUNTING_SEMANTICS,
  FIX_PROVE_STATUSES,
  buildFixProveEvidencePacket,
  classifyPriorFinding,
  dependencyCountPresentation,
  renderFixProveMarkdown,
} from '../src/fix-prove-evidence.js';

const priorDependency = {
  findingId: 'dep-image-size',
  ruleId: 'ARL-DEP-004',
  title: 'Known vulnerable locked dependency',
  severity: 'high',
  evidence: {
    package: 'image-size',
    installedVersion: '1.2.1',
    advisoryId: 'GHSA-5p2g-fcmc-qvqq',
    component: 'apps/mobile',
  },
};

test('Fix → Prove uses fresh bounded wording and does not imply third-party independence', () => {
  const packet = buildFixProveEvidencePacket({
    caseId: 'ARL-CASE-1',
    target: 'example/repo',
    previousSnapshot: 'a'.repeat(40),
    currentSnapshot: 'b'.repeat(40),
    priorFindings: [],
    currentFindings: [],
    posture: { postureScore: 100, technicalRisk: 0 },
  });
  const markdown = renderFixProveMarkdown(packet);

  assert.match(markdown, /Fresh bounded re-assessment/);
  assert.doesNotMatch(markdown, /independent\s+(?:audit|security assessment|penetration test|re-?scan)/i);
});

test('dependency counts preserve tool-specific counting semantics instead of pretending totals are comparable', () => {
  const evidence = dependencyCountPresentation({
    inventoryCount: 109,
    externalCounts: [
      { source: 'npm', count: 14 },
      { source: 'Pub', count: 100 },
    ],
  });

  assert.equal(evidence.inventory_count, 109);
  assert.equal(evidence.external_scanner_extracted_count, 114);
  assert.equal(evidence.counts_directly_comparable, false);
  assert.equal(evidence.counting_semantics, DEPENDENCY_COUNTING_SEMANTICS);
  assert.match(evidence.counting_semantics, /not expected to match exactly/i);
});

test('removed affected component becomes NO LONGER APPLICABLE only with fresh observed absence evidence', () => {
  const lifecycle = classifyPriorFinding({
    priorFinding: priorDependency,
    verification: {
      kind: 'component-removed',
      currentSnapshotAbsenceConfirmed: true,
      fresh: true,
      rationale: 'The legacy mobile workspace and its lockfile are absent from the new active snapshot.',
    },
  });

  assert.equal(lifecycle.status, FIX_PROVE_STATUSES.NO_LONGER_APPLICABLE);
});

test('a claimed fix without fresh proof does not close the prior finding', () => {
  const lifecycle = classifyPriorFinding({
    priorFinding: priorDependency,
    verification: { claimOnly: true, kind: 'partial' },
  });

  assert.equal(lifecycle.status, FIX_PROVE_STATUSES.PARTIALLY_RESOLVED);
});

test('a finding still observed by the fresh scan remains NOT RESOLVED', () => {
  const lifecycle = classifyPriorFinding({
    priorFinding: priorDependency,
    currentFinding: priorDependency,
    verification: {
      kind: 'retest-pass',
      fresh: true,
      bounded: true,
      supportsResolution: true,
    },
  });

  assert.equal(lifecycle.status, FIX_PROVE_STATUSES.NOT_RESOLVED);
});

test('fresh bounded retest can resolve a finding when the evidence explicitly supports closure', () => {
  const lifecycle = classifyPriorFinding({
    priorFinding: { findingId: 'repo-security', ruleId: 'ARL-REPO-001', title: 'Security policy is missing' },
    verification: {
      kind: 'retest-pass',
      fresh: true,
      bounded: true,
      supportsResolution: true,
      rationale: 'SECURITY.md is present and the fresh Inspector no longer emits ARL-REPO-001.',
    },
  });

  assert.equal(lifecycle.status, FIX_PROVE_STATUSES.RESOLVED);
});

test('current-only findings are first-class NEW FINDING lifecycle entries', () => {
  const packet = buildFixProveEvidencePacket({
    priorFindings: [],
    currentFindings: [{ findingId: 'new-1', ruleId: 'ARL-REPO-003', title: 'Stale scope reference', severity: 'low' }],
  });

  assert.equal(packet.PROVE.findingComparison.length, 1);
  assert.equal(packet.PROVE.findingComparison[0].lifecycleStatus, FIX_PROVE_STATUSES.NEW_FINDING);
});

test('100/100 remains explicitly scoped and never becomes an affirmative security claim', () => {
  const packet = buildFixProveEvidencePacket({
    posture: {
      postureScore: 100,
      technicalRisk: 0,
      conclusion: 'No material issue was observed in the inspected source scope.',
    },
  });
  const markdown = renderFixProveMarkdown(packet);

  assert.match(markdown, /100\/100/);
  assert.match(markdown, /Runtime and cloud controls may remain outside scope/i);
  assert.match(markdown, /not an accredited certification or a guarantee that the assessed system is risk-free/i);
  assert.doesNotMatch(markdown, /\b(?:is|remains|proved|proven)\s+(?:fully\s+)?secure\b/i);
  assert.doesNotMatch(markdown, /\b(?:is|proved|proven)\s+certified\b/i);
  assert.doesNotMatch(markdown, /\b(?:is|proved|proven)\s+production[- ]safe\b/i);
});

test('unsupported assurance wording is rejected rather than normalized into a stronger claim', () => {
  assert.throws(() => buildFixProveEvidencePacket({
    posture: { postureScore: 100, conclusion: 'The system is fully secure and production-safe.' },
  }), /unsupported assurance/i);
});

test('deployment decision is NOT RECORDED unless an accountable human record is supplied', () => {
  const absent = buildFixProveEvidencePacket({ deploymentDecision: { decision: 'Proceed' } });
  assert.equal(absent.DEPLOYMENT_DECISION.decision, 'NOT RECORDED');

  const recorded = buildFixProveEvidencePacket({
    deploymentDecision: {
      decision: 'Proceed',
      recordedBy: 'Accountable owner',
      recordedAt: '2026-08-28T14:00:00+01:00',
      rationale: 'Evidence reviewed.',
    },
  });
  assert.equal(recorded.DEPLOYMENT_DECISION.decision, 'Proceed');
});

test('packet standardizes FIND, FIX, PROVE, REMAINING GAPS and DEPLOYMENT DECISION', () => {
  const packet = buildFixProveEvidencePacket({ remainingGaps: ['Runtime configuration was not evidenced.'] });
  assert.ok(packet.FIND);
  assert.ok(packet.FIX);
  assert.ok(packet.PROVE);
  assert.deepEqual(packet.REMAINING_GAPS, ['Runtime configuration was not evidenced.']);
  assert.ok(packet.DEPLOYMENT_DECISION);
});
