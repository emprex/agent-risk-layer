# AgentRiskLayer v10.1.1 — billing and external-validation workflow evidence

Date: 2026-08-09  
Implementation commit assessed: `b9c8dfb28071eb8490e3cd7c17d65f41e5832b11`  
Scoring semantics: `arl-risk-v3.4`

## Scope

This record covers only:

1. production/demo billing presentation hardening on the pricing surface;
2. the design-partner evidence-case/publication protocol;
3. the ClawHub Security Signals / AgentRisk Inspector benchmark workflow and claim boundaries.

It does not re-certify the full application or repeat the earlier v3.4 production acceptance suite.

## Production/demo billing finding

A public search-engine crawl of `https://agentrisklayer.com/pricing.html` retrieved on 2026-08-09 still contained the rendered message:

> Demo mode is active. Subscription checkout is simulated and can be cancelled from the dashboard.

The Trust Centre crawl simultaneously described the service as production and stated that Stripe payments were live. This is a public-claims contradiction even though the repository/Render configuration declares `DEMO_MODE=false` and production startup has a readiness check requiring demo payments to be disabled.

Direct live requests to `/api/config` and `/api/ready` could not be completed from the execution environment because DNS resolution for `agentrisklayer.com` was unavailable. Therefore this record does not claim that the live Render environment itself returned `demoMode=true` at the time of implementation.

### Remediation implemented

`public/pricing-mode.js` now derives an explicit presentation mode:

- production + `demoMode=false` → live checkout presentation;
- non-production + `demoMode=true` → clearly labelled simulated/demo presentation;
- production + `demoMode=true` → fail-closed `production_billing_blocked`; simulated checkout is not presented and recurring checkout buttons are disabled.

`public/pricing.js` applies that state without changing Stripe, Render or authentication configuration.

### Focused validation

Local isolated Node tests against the exact pricing-mode logic:

- production live billing: PASS
- non-production demo labelling: PASS
- production/demo mismatch fails closed: PASS

Pricing-mode + benchmark focused suite total: **7 passed, 0 failed, 0 skipped**.

Relevant modules also passed `node --check` in the isolated validation workspace:

- `public/pricing-mode.js`
- `src/clawhub-inspector-benchmark.js`
- `scripts/run-clawhub-inspector-benchmark.mjs`
- pricing integration syntax was separately checked against the implemented control flow.

## Design-partner evidence-case protocol

`docs/DESIGN_PARTNER_EVIDENCE_CASE_PROTOCOL.md` records the required evidence chain, version binding, scope/authorisation requirements, finding standard, remediation/retest requirements and publication permission gate.

No design-partner technical result is claimed by this implementation. A questionnaire baseline remains declared/unverified evidence until artifacts are observed or a bounded test is executed.

## ClawHub Inspector benchmark workflow

The runner is bound to the existing frozen corpus revision and per-split SHA-256/row-count controls already recorded in the external-intelligence integration.

The benchmark:

- treats corpus artifacts as inert untrusted text;
- reconstructs them only in temporary local directories;
- never executes corpus code;
- performs no network probing;
- excludes VirusTotal-derived fields;
- preserves the source split and protects `eval_holdout` from tuning/rule-development use;
- uses the existing AgentRisk Inspector, rather than modifying Inspector rules from holdout results;
- excludes generic temporary-repository hygiene findings from comparison;
- reports pairwise concordance/disagreement and predeclared semantic mappings;
- records explicit external-signal categories for which no Inspector rule is currently mapped.

The public claim boundary is **concordance, not accuracy or superiority** because the external corpus is silver-standard scanner evidence rather than human-adjudicated ground truth.

## Benchmark execution status

The full pinned ClawHub benchmark was **not executed** in this validation environment. The exact frozen JSONL split could not be downloaded because the runtime had no external DNS/network access to Hugging Face/Xet.

No quantitative AgentRiskLayer/ClawHub performance result is therefore recorded or permitted by this validation record.

## Remaining verification

Before calling the production billing contradiction fully closed:

1. confirm Render deployed the current `main` commit;
2. query live `/api/config` and confirm `productStage=production` and `demoMode=false`;
3. query live `/api/ready` and confirm readiness HTTP 200 with the live-payments check passing;
4. open production `/pricing.html` in a fresh browser session and confirm no simulated/demo checkout notice is rendered;
5. perform an authorised checkout smoke up to the Stripe-hosted checkout page without completing payment, if owner approval allows it.

Before publishing any ClawHub benchmark metric:

1. acquire the exact pinned split file;
2. verify its SHA-256 and row count;
3. run `test` first to validate the workflow operationally;
4. freeze the current Inspector/policy version;
5. run `eval_holdout` exactly once for the final evaluation record;
6. archive the JSON result and limitations before any rule changes are made from the holdout evidence.

## Limitations

- GitHub currently exposes no CI status checks for this commit.
- The full repository test/smoke/scenario suite was not available in this execution environment.
- No live production endpoint result is claimed here because direct DNS resolution was unavailable.
- No ClawHub benchmark performance claim is made because the full frozen corpus was unavailable locally.
