# AgentRiskLayer v10.1.1 — billing and external-validation workflow evidence

Date: 2026-08-09
Repository validation baseline: `b846dab4025f79cdb5f37bef8ec0418dbe0f4dd1`
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

The initial implementation environment could not resolve the production domain, so no live-state claim was made at that stage.

Production was subsequently verified from the owner-operated Debian environment on 2026-08-09:

- `GET /api/config` returned `productStage=production` and `demoMode=false`;
- `GET /api/ready` returned HTTP 200 with `ok=true` and `readiness.ready=true`;
- the database adapter reported `postgres`;
- the production schema reported `schemaCurrent=true`, `migrationCount=17`, and latest migration `017_external_security_intelligence.sql`;
- the required `live_payments` readiness check passed;
- required Stripe secret, webhook, price, transactional-email, support, legal-identity and metrics-auth readiness checks passed;
- deployed `/pricing.js` contained the `resolvePricingMode` control flow;
- direct retrieval of `/pricing.html` contained no crawlable `Demo mode` or `simulated checkout` message.

The readiness response carried timestamp `2026-08-09T20:24:08.565Z`.

These observations close the original production/demo presentation contradiction for the directly observed production state. They do not establish what a stale third-party search cache may continue to display until that cache is refreshed.

### Remediation implemented

`public/pricing-mode.js` now derives an explicit presentation mode:

- production + `demoMode=false` → live checkout presentation;
- non-production + `demoMode=true` → clearly labelled simulated/demo presentation;
- production + `demoMode=true` → fail-closed `production_billing_blocked`; simulated checkout is not presented and recurring checkout buttons are disabled.

`public/pricing.js` applies that state without changing Stripe, Render or authentication configuration.

### Local validation

After synchronising local `main` with GitHub, the complete repository test suite was executed from `/home/guillaume/agent-risk-layer-fix`.

The initial run identified two stale regression-test expectations:

1. the PostgreSQL test expected 16 migrations although migration 017 had intentionally been added;
2. the SEO regression expected the old direct `cfg.demoMode` branch in `pricing.js` although pricing now uses `resolvePricingMode(cfg)`.

No production logic was changed to satisfy those failures. Only the obsolete test expectations were updated.

The affected PostgreSQL and SEO suites were rerun first:

- **17 tests passed**
- **0 failed**

The complete `npm test` suite was then rerun:

- **240 tests**
- **240 passed**
- **0 failed**
- **0 skipped**
- duration approximately 40 seconds

The regression-test corrections were committed as:

`b846dab4025f79cdb5f37bef8ec0418dbe0f4dd1` — `Update regression tests for external intelligence and pricing mode`.

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

## Production billing verification status

The production/demo contradiction is closed for the directly observed production state:

- production configuration: VERIFIED
- demo payments disabled: VERIFIED
- readiness HTTP 200: VERIFIED
- PostgreSQL schema current through migration 017: VERIFIED
- live-payments readiness control: VERIFIED
- deployed pricing-mode resolver: VERIFIED
- crawlable pricing HTML free of the demo/simulated-checkout message: VERIFIED

An end-to-end checkout smoke through creation of a Stripe-hosted Checkout session has not been executed as part of this record. No payment was attempted.

The exact Git commit SHA deployed by Render was not exposed by the checked public endpoints, so the runtime evidence is bound to the observed production behavior and application version `10.1.1`, not to an independently observed Render deployment SHA.

## Remaining ClawHub benchmark verification

Before publishing any ClawHub benchmark metric:

1. acquire the exact pinned split file;
2. verify its SHA-256 and row count;
3. run `test` first to validate the workflow operationally;
4. freeze the current Inspector/policy version;
5. run `eval_holdout` exactly once for the final evaluation record;
6. archive the JSON result and limitations before any rule changes are made from the holdout evidence.

## Limitations

- GitHub exposes no CI status checks for this validation baseline; the recorded test evidence is owner-operated local execution.
- The public production endpoints checked do not expose the exact Render deployment Git SHA.
- No live Stripe Checkout session was created during this verification.
- No ClawHub benchmark performance claim is made because the full pinned benchmark has not yet been executed.
- The ClawHub corpus remains external silver-standard scanner evidence, not human-adjudicated ground truth.
- This record covers the stated billing presentation, design-partner protocol and external-intelligence workflow scope; it is not an accredited certification or a guarantee that AgentRiskLayer is risk-free.
