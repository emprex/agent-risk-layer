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

test('KB-012 routes all canonical experimentation-to-production boundary evidence without inferring enforcement', () => {
  const requirements = [
    'ARL-KB-012 assessed system, exact version, environment and experimental-versus-production scope',
    'Approved environment, identity, credential, network and provider configuration defining the experimentation-to-production boundary',
    'Identity, network, provider, billing or audit evidence showing which experimental agents, notebooks, credentials and endpoints were observed',
    'Bounded positive evidence showing the approved experimental workflow operates only with authorised sandbox resources',
    'Bounded negative evidence showing an experimental or unofficial identity cannot reach the prohibited production-equivalent data, credential, tool or service path',
    'Tester identity, role, timestamp and evidence digest binding the observations to the assessed version'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.map(item => item.mode),
    ['machine_collectable', 'human_only', 'active_test_or_runtime',
      'active_test_or_runtime', 'active_test_or_runtime', 'human_only']
  );
  assert.deepEqual(plan[0].collectors, ['target_identity']);
  for (const index of [1, 2, 3, 4, 5]) {
    assert.deepEqual(plan[index].collectors, []);
  }
});

test('KB-013 keeps approved egress inventory human-owned and runtime network traces non-static', () => {
  const requirements = [
    'ARL-KB-013 assessed system, exact version, environment and network scope',
    'Declared inventory of authorised external destinations, tools, webhooks, callbacks and egress routes',
    'Relevant source, proxy, DNS, firewall, allowlist or tool configuration governing outbound access',
    'Observed runtime DNS, HTTP, proxy, tool or network records for approved and attempted unapproved destinations',
    'ARL-KB-013 tester identity, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map(row=>row.mode), [
    'machine_collectable', 'human_only', 'machine_collectable',
    'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[2].collectors.includes('source_and_configuration'));
  for (const index of [1,3,4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-014 retains credential ownership and lifecycle authority outside deterministic discovery', () => {
  const requirements = [
    'ARL-KB-014 assessed system, exact version, environment and credential scope',
    'Authoritative credential or workload-identity inventory with owner, purpose, scope and lifecycle state',
    'Secret-store, environment, CI/CD and runtime references showing which credentials the assessed version can use',
    'Evidence of expiry, rotation, revocation or short-lived issuance where applicable',
    'Tester identity, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'human_only', 'machine_collectable',
    'human_only', 'human_only'
  ]);
  assert.deepEqual(plan[0].collectors, ['target_identity']);
  assert.deepEqual(plan[2].collectors, ['source_and_configuration']);
  for (const index of [1, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-015 memory and vector-store evidence requires distinct source, runtime and human authority', () => {
  const requirements = [
    'ARL-KB-015 assessed system, version, environment and scope for Memory and vector stores are untracked',
    'ARL-KB-015 control configuration or source location showing how reduce the likelihood and impact of memory and vector stores are untracked and make the remaining risk visible.',
    'ARL-KB-015 positive and abuse inputs with expected and observed outputs for tenant-scoped records and object identifiers and service identities, roles and credentials',
    'ARL-KB-015 policy, authorization, tool or audit events proving whether the tested memory and vector stores are untracked path executed',
    'ARL-KB-015 tester identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-016 distinguishes model version source evidence from actual drift execution and human attribution', () => {
  const requirements = [
    'ARL-KB-016 assessed system, version, environment and scope for Model versions and digests are not pinned',
    'ARL-KB-016 control configuration or source location showing how reduce the likelihood and impact of model versions and digests are not pinned and make the remaining risk visible.',
    'ARL-KB-016 positive and abuse inputs with expected and observed outputs for model and dependency artefacts and build, registry and deployment provenance',
    'ARL-KB-016 policy, authorization, tool or audit events proving whether the tested model versions and digests are not pinned path executed',
    'ARL-KB-016 tester identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-017 dependency bill keeps source observations separate from active verification and human attribution', () => {
  const requirements = [
    'ARL-KB-017 assessed system, version, environment and scope for Software and AI dependency bill is missing',
    'ARL-KB-017 control configuration or source location showing how reduce the likelihood and impact of software and ai dependency bill is missing and make the remaining risk visible.',
    'ARL-KB-017 positive and abuse inputs with expected and observed outputs for model and dependency artefacts and build, registry and deployment provenance',
    'ARL-KB-017 policy, authorization, tool or audit events proving whether the tested software and ai dependency bill is missing path executed',
    'ARL-KB-017 tester identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-018 environment separation keeps source evidence distinct from bounded behavior and accountable testing', () => {
  const requirements = [
    'ARL-KB-018 assessed system, version, environment and scope for Environment separation is weak',
    'ARL-KB-018 control configuration or source location showing how reduce the likelihood and impact of environment separation is weak and make the remaining risk visible.',
    'ARL-KB-018 positive and abuse inputs with expected and observed outputs for tool endpoints and downstream systems and financial, administrative or state-changing actions',
    'ARL-KB-018 policy, authorization, tool or audit events proving whether the tested environment separation is weak path executed',
    'ARL-KB-018 tester identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});

test('KB-019 authentication fail-open requires active denial proof and accountable attribution', () => {
  const requirements = [
    'ARL-KB-019 assessed system, version, environment and scope for Authentication is missing or can fail open',
    'ARL-KB-019 control configuration or source location showing how reduce the likelihood and impact of authentication is missing or can fail open and make the remaining risk visible.',
    'ARL-KB-019 positive and abuse inputs with expected and observed outputs for tool endpoints and downstream systems and financial, administrative or state-changing actions',
    'ARL-KB-019 policy, authorization, tool or audit events proving whether the tested authentication is missing or can fail open path executed',
    'ARL-KB-019 tester identity, role, timestamp and evidence digest'
  ];
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2, 3, 4]) assert.deepEqual(plan[index].collectors, []);
});
