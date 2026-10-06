import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const redteam = fs.readFileSync(
  new URL('../src/redteam.js', import.meta.url),
  'utf8'
);
const handoff = fs.readFileSync(
  new URL('../src/agent/exact-retest-redteam-handoff.mjs', import.meta.url),
  'utf8'
);
const resolver = fs.readFileSync(
  new URL('../src/agent/tools/resolve-persisted-exact-retest-continuation.mjs', import.meta.url),
  'utf8'
);
const completion = fs.readFileSync(
  new URL('../src/agent/tools/complete-authoritative-redteam-retest.mjs', import.meta.url),
  'utf8'
);
const orchestrator = fs.readFileSync(
  new URL('../src/agent/arl-operational-orchestrator.mjs', import.meta.url),
  'utf8'
);

test('exact retest supports explicit immutable reauthorisation lineage', () => {
  assert.match(redteam, /EXACT_RETEST_REAUTHORISATION_CONFIRMATION/);
  assert.match(redteam, /redteam_exact_retest_reauthorised/);
  assert.match(redteam, /verifyExactRetestAuthorisationLineage/);
  assert.match(redteam, /sameAuthorisationScopeRows/);

  assert.match(handoff, /detectExactRetestReauthorisationCommand/);
  assert.match(handoff, /reauthoriseExactRetestRedTeamHandoff/);
  assert.match(handoff, /exact_retest_reauthorisation_required/);
  assert.match(handoff, /verifyExactRetestAuthorisationLineage/);

  assert.match(resolver, /authorisationLineageVerified/);
  assert.match(resolver, /verifyExactRetestAuthorisationLineage/);

  assert.match(completion, /verifyExactRetestAuthorisationLineage/);
  assert.doesNotMatch(
    completion,
    /failedRedTeamOutcome\.authorisationId !== retestRedTeamOutcome\.authorisationId\s*\)\s*\{\s*return/
  );

  assert.match(orchestrator, /exactRetestReauthorisationCommand/);
  assert.match(orchestrator, /new immutable Rules of Engagement record/);
});
