# Red Team local adapter workflow fix

## Problem

The Red Team backend and runner already support authorised `local`, `test` and `staging` environments, but the browser campaign builder exposed only a staging adapter path and hard-coded `environment: staging` when it created Rules of Engagement and generated the runner command.

That mismatch forced local synthetic design-partner testing into manual browser-console workarounds and made an exact baseline/retest workflow unnecessarily difficult.

## Fix

The Red Team workspace now:

- exposes one **Authorised adapter test** mode for local, test and staging targets;
- defaults to local mode for localhost adapters;
- mirrors the runner endpoint safety rules: local mode is localhost-only, remote test/staging endpoints require HTTPS;
- creates Rules of Engagement with the selected environment;
- generates a runner command with the same selected environment instead of forcing staging;
- keeps the existing server token mode used for adapter-backed evidence, so upload and evidence semantics remain backward compatible;
- lets the operator enter one exact Red Team case ID, such as `RT-PI-008`, for comparable failed-baseline and passed-retest evidence;
- automatically adds `--no-mutation --adaptive-rounds 1` when an exact case is selected so the request fingerprint remains comparable;
- shows the adapter environment and stored endpoint origin in Rules of Engagement history when available;
- preserves the existing `integrity_verified_customer_operated` trust boundary. No production target support is added.

## Validation

GitHub Actions validation run `31696621820` on product/test head `8a74e290d6f278d186af51fa9ae6f0f4e63ca323` passed:

- `npm ci`: 14 packages, 0 reported vulnerabilities;
- `npm run check`: passed;
- focused Red Team + adapter-environment regressions: 17/17 passed;
- full `npm test`: 335 tests, 334 passed, 0 failed, 1 existing PostgreSQL-only skip;
- published Red Team runner remained 5.2.0 / `arl-redteam-policy-2026.10` with SHA-256 `7dc93d85f6b11edd5aa2815804b6c54acacf609861e026164674caf2f600b06d`.

An earlier temporary validation run failed only because the focused test command omitted `NODE_ENV=test`; `npm run check` and the four new UI regressions had already passed. The validation workflow was corrected, rerun successfully, and removed from the final branch.

## Evidence boundary

This UX fix does not independently attest a customer target and does not close any finding. A qualifying Control Intelligence binding still requires an uploaded signed failed baseline and newer passed retest for the same assessment, Rules of Engagement, target descriptor, policy version, case title and request fingerprint, followed by the existing human closure review.
