import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalEvidenceRequirementPlan,
  classifyCanonicalEvidenceRequirement
} from '../src/agent/canonical-evidence-requirement-plan.mjs';

test('KB-004-like capability evidence is machine-observable while classification rationale stays human', () => {
  const plan = buildCanonicalEvidenceRequirementPlan([
    'ARL-KB-004 observed inventory of impact-relevant capabilities, including authority, reachable assets, data access, maximum action values, reversibility, scale, affected people and dependency chains',
    'ARL-KB-004 documented comparison between the declared risk tier and the maximum credible observed impact, including classification rationale',
    'ARL-KB-004 evidence for any capability or configuration materially affecting the impact classification',
    'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest'
  ]);

  assert.deepEqual(
    plan.map((item) => item.mode),
    [
      'machine_collectable',
      'human_only',
      'machine_collectable',
      'human_only'
    ]
  );

  assert.ok(
    plan[0].collectors.includes(
      'data_and_capability_observation'
    )
  );
});

test('KB-005-like architecture evidence is collected deterministically before human review', () => {
  const plan = buildCanonicalEvidenceRequirementPlan([
    'ARL-KB-005 versioned architecture and trust-boundary model',
    'ARL-KB-005 documented actors, trust zones, data flows, stores, tools, network destinations and approval points',
    'ARL-KB-005 source or configuration evidence supporting representative documented flows',
    'ARL-KB-005 known limitations, alternate paths and unresolved architecture uncertainties',
    'ARL-KB-005 reviewer identity, timestamp and evidence digest'
  ]);

  assert.deepEqual(
    plan.map((item) => item.mode),
    [
      'machine_collectable',
      'machine_collectable',
      'machine_collectable',
      'human_only',
      'human_only'
    ]
  );
});

test('runtime and execution-path evidence is never downgraded to human prose', () => {
  const values = [
    'Observed runtime DNS, HTTP, proxy, tool or network records for approved and attempted unapproved destinations',
    'ARL-KB-015 policy, authorization, tool or audit events proving whether the tested memory and vector stores are untracked path executed',
    'Identity, network, provider, billing or audit evidence showing which experimental agents, notebooks, credentials and endpoints were observed',
    'Bounded negative evidence showing a prohibited action is denied before side effects'
  ];

  for (const value of values) {
    assert.equal(
      classifyCanonicalEvidenceRequirement(value).mode,
      'active_test_or_runtime'
    );
  }
});

test('accountable approval, legal-basis and reviewer evidence remain human-only', () => {
  const values = [
    'Accountable human reviewer identity, role, timestamp, decision and evidence digest',
    'Organisation-approved purpose and asserted legal-basis record for applicable processing',
    'Decision record showing that aggregate score cannot override a mandatory failed gate',
    'Authoritative declared inventory or register used for the assessed version'
  ];

  for (const value of values) {
    assert.equal(
      classifyCanonicalEvidenceRequirement(value).mode,
      'human_only'
    );
  }
});


test('KB-006 behavioral handling evidence stays on the runtime or active-test path', () => {
  const values = [
    'ARL-KB-006 evidence showing classification and handling across representative model, tool, log, persistence and export paths',
    'ARL-KB-006 evidence of redaction, denial, retention or export restriction for restricted data'
  ];

  for (const value of values) {
    assert.equal(
      classifyCanonicalEvidenceRequirement(value).mode,
      'active_test_or_runtime'
    );
  }
});

test('KB-014 authoritative credential ownership and lifecycle inventory stays human-controlled', () => {
  const values = [
    'Authoritative credential or workload-identity inventory with owner, purpose, scope and lifecycle state',
    'Credential inventory with owner, purpose, scope and lifecycle state'
  ];

  for (const value of values) {
    assert.equal(
      classifyCanonicalEvidenceRequirement(value).mode,
      'human_only'
    );
  }
});

test('KB-014 technical credential references remain deterministic machine evidence', () => {
  const result =
    classifyCanonicalEvidenceRequirement(
      'Secret-store, environment, CI/CD and runtime references showing which credentials the assessed version can use'
    );

  assert.equal(
    result.mode,
    'machine_collectable'
  );
  assert.ok(
    result.collectors.includes(
      'source_and_configuration'
    )
  );
});

test('KB-009 routes version-bound approval to human review, never static machine evidence', () => {
  const requirements = [
    'ARL-KB-009 exact assessed production version, environment and authoritative deployment identity',
    'ARL-KB-009 security-relevant change classification and description',
    'ARL-KB-009 review, threat-model or equivalent risk-analysis evidence required for the material change',
    'ARL-KB-009 tests and approval attributable to the exact version or immutable artefact',
    'ARL-KB-009 deployment provenance showing which reviewed version became authoritative in production',
    'ARL-KB-009 stale-evidence, unreviewed-change or version-substitution test result',
    'ARL-KB-009 reviewer identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(
    plan.map(item => item.mode),
    ['machine_collectable', 'human_only', 'human_only', 'human_only',
      'human_only', 'active_test_or_runtime', 'human_only']
  );
  assert.deepEqual(plan[3].collectors, []);
  assert.ok(plan[0].collectors.includes('target_identity'));
});

test('immutable source version alone is not attributable approval', () => {
  assert.equal(
    classifyCanonicalEvidenceRequirement(
      'Tests and approval attributable to the exact version or immutable artifact'
    ).mode,
    'human_only'
  );
  assert.equal(
    classifyCanonicalEvidenceRequirement(
      'Model versions and digests'
    ).mode,
    'machine_collectable'
  );
});
