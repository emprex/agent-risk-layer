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
