# ARL-RKA-1.1.0 integration validation

## Assessed system and scope

- Source supplied by owner: `agent-risk-layer-fix-main.zip`
- Recorded source baseline: repository commit `7e31f0d`
- Local inspection repository: `/mnt/data/arl-repo`
- Application version in source: `10.0.1`
- Risk knowledge profile: `ARL-RKA-1.1.0`
- Assessment date: 2026-08-05

Scope included additive database migrations, seed integrity, public and authenticated website routes, project authorization, tenant isolation, evidence-link integrity, retention behaviour, account export, control-manifest export, customer-facing HTML/JavaScript, source checks and the existing release regression suite.

Excluded and unverified: the owner machine's uncommitted files, the current GitHub remote, a real PostgreSQL server, Render production configuration, production migration execution, live Stripe/Resend journeys, DNS, browser/device visual review, push and deployment.

## Database validation

An isolated SQLite database loaded the same migrations and seeds used by the PostgreSQL migration path.

| Structure | Count |
|---|---:|
| Risk entries | 108 |
| Checks | 108 |
| Solutions | 108 |
| References | 11 |
| Framework mappings | 204 |
| Operational metadata records | 108 |
| Applicability predicates | 121 |
| Foreign-key violations | 0 |

Migration review confirmed that the source archive ended at `008_runtime_approval_integrity.sql`; the integration adds migrations 009 through 012. Seed migrations contain no top-level transaction control because the existing migration runner owns the PostgreSQL transaction and advisory lock.

## Executed tests

### Release validation

Command: `npm run validate`

Result: passed.

- Complete isolated Node test suite: **181/181 passed, 0 failed, 0 skipped**
- JavaScript syntax/source checks: passed
- End-to-end smoke journey: passed
- Internal synthetic detection regression: 20/20 cases, with the repository's existing limitation that this is not an independent or production-representative benchmark
- Deterministic scenario regression: **1,000/1,000 passed**, `unsafeDecisions=0`, `criticalPathScenarios=387`, `averageScore=72`

### Local load exercise

Command: `npm run test:load`

Result: 5,000 local requests, 0 errors, 0% error rate, approximately 3,008 requests/second; p50 29.3 ms, p95 50.4 ms, p99 155.9 ms. This exercise covered local mixed public-read and per-user CSRF/session traffic only, not external services or production infrastructure.

### Risk-knowledge-specific evidence

Tests exercised:

- public list/detail separation from exact checks and pass/fail criteria
- verified-account detail and JSON manifest export
- Rego export blocked when executable semantics are not verified
- unknown/unsupported architecture facts rejected or retained for review
- global CSRF enforcement and profiler rate limiting
- project roles and cross-workspace denial
- rejection of caller-supplied gates, evidence counts, workspace IDs and user IDs
- server-side evidence-subject resolution
- unsupported or non-project-bound evidence types failing closed
- duplicate evidence-link idempotency
- evidence-state transition rules
- runtime action approval not being treated as residual-risk acceptance
- exact, completed, passed and runtime-bound retest requirements
- retention removing links and expiring evidence without silently clearing an open critical finding
- re-profiling not bypassing an existing critical finding
- account export containing project risk states and versioned evidence links
- public pages containing no inline styles under the existing CSP policy

## Dependency-installation limitation

`npm ci --ignore-scripts` could not complete in this execution environment because the internal package mirror returned HTTP 404 for `xtend@4.0.2`. This is an environment/package-mirror limitation, not evidence that a clean owner-machine installation succeeds. The validation commands above ran using Node built-ins and the source's test adapter; the production `pg` dependency was therefore not exercised against a real database.

## Claims boundary

This record supports an **AgentRiskLayer Security Assessment against AgentRiskLayer Control Profile ARL-RKA-1.1.0**. It is not an accredited certification, legal opinion, proof of compliance, production deployment record or guarantee that the system is risk-free.

The integration is ready for owner-machine comparison, disposable PostgreSQL migration testing, ordinary Git review and controlled deployment verification. It is not represented as pushed, deployed or live.
