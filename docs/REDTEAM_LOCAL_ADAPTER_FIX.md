# Red Team local adapter workflow fix

## Problem

The Red Team backend and runner already support authorised `local`, `test` and `staging` environments, but the browser campaign builder exposed only a staging adapter path and hard-coded `environment: staging` when it created Rules of Engagement and generated the runner command.

That mismatch forced local synthetic design-partner testing into manual browser-console workarounds and made an exact baseline/retest workflow unnecessarily difficult.

A second workflow defect was identified during review: Control Intelligence requires an exact failed baseline and passed retest to use the same Rules of Engagement authorisation, while the browser campaign builder always created a new authorisation for every adapter command.

## Fix

The Red Team workspace now:

- exposes one **Authorised adapter test** mode for local, test and staging targets;
- defaults to local mode for localhost adapters;
- mirrors the runner endpoint safety rules: local mode is localhost-only, remote test/staging endpoints require HTTPS;
- creates Rules of Engagement with the selected environment;
- lets an operator reuse an existing active Rules of Engagement record for an exact baseline/retest pair instead of creating a second authorisation;
- fails closed when a reused authorisation has expired or when a stored endpoint origin conflicts with the requested endpoint;
- generates a runner command with the selected/reused environment instead of forcing staging;
- keeps the existing server token mode used for adapter-backed evidence, so upload and evidence semantics remain backward compatible;
- lets the operator enter one exact Red Team case ID, such as `RT-PI-008`, for comparable failed-baseline and passed-retest evidence;
- automatically adds `--no-mutation --adaptive-rounds 1` when an exact case is selected so the request fingerprint remains comparable;
- shows Rules of Engagement IDs and Red Team run IDs directly in history so the evidence-binding workflow does not require URL inspection;
- shows the adapter environment and stored endpoint origin in Rules of Engagement history when available;
- preserves the existing `integrity_verified_customer_operated` trust boundary. No production target support is added.

## Validation

GitHub Actions validation run `31697083177` on validation head `fd6648ff155a1c361a6cdad82ec44611091e8478` passed:

- Ubuntu 24.04, Node 22.23.1;
- `npm ci`: 14 packages, 0 reported vulnerabilities;
- `npm run check`: passed;
- focused Red Team + adapter-environment/reuse regressions: 19/19 passed;
- full `npm test`: 337 tests, 336 passed, 0 failed, 1 existing PostgreSQL-only skip;
- exact Control Intelligence Red Team baseline/retest binding and mismatched-request-fingerprint regressions remained green;
- published Red Team runner remained 5.2.0 / `arl-redteam-policy-2026.10` with SHA-256 `7dc93d85f6b11edd5aa2815804b6c54acacf609861e026164674caf2f600b06d`.

Earlier temporary validation runs were used while the UI fix was being refined. The final validation above covers the reusable-authorisation workflow. The temporary validation workflow was removed from the final branch.

## Evidence boundary

This UX fix does not independently attest a customer target and does not close any finding. A qualifying Control Intelligence binding still requires an uploaded signed failed baseline and newer passed retest for the same assessment, Rules of Engagement, target descriptor, policy version, case title and request fingerprint, followed by the existing human closure review.
