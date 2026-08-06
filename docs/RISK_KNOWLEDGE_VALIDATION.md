# ARL-RKA-1.2.0 integration validation

## Assessed system and scope

- Source supplied by owner: `agent-risk-layer-fix-main.zip`
- Recorded source baseline: repository commit `02271bf`
- Local inspection repository: `/home/guillaume/agent-risk-layer-fix`
- Application version in source: `10.1.1`
- Risk knowledge profile: `ARL-RKA-1.2.0`
- Assessment date: 2026-08-06

Scope included additive database migrations, seed integrity, public and authenticated website routes, project authorization, tenant isolation, evidence-link integrity, retention behaviour, account export, control-manifest export, customer-facing HTML/JavaScript, source checks and the existing release regression suite.

The contextual-severity clarification was implemented without a new migration. Public catalogue records remain `severity: null` with `context_required`; project readiness reads evaluated values only from the existing tenant-bound `project_risk_context` model. Priority, lifecycle state and catalogue content were not promoted or converted into severity.

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
| Predicate registry records | 66 |
| Candidate lifecycle records | 108 |
| Foreign-key violations | 0 |

The verified starting commit already contained migrations 009 through 012. This change adds migrations 013 and 014. Seed migrations contain no top-level transaction control because the existing PostgreSQL migration runner owns the transaction and advisory lock.

## Executed tests

### Validation commands

- Complete isolated Node test suite (`npm test`): **191/191 passed, 0 failed, 0 skipped**
- JavaScript syntax/source checks (`npm run check`): passed
- End-to-end customer journey (`npm run smoke`): passed
- Deterministic scenario regression: **1,000/1,000 passed**, `unsafeDecisions=0`, `criticalPathScenarios=387`, `averageScore=72`
- Focused asset, SQLite integration, HTTP, authorization and PostgreSQL migration-contract tests: passed.
- A real PostgreSQL service was not configured, so production-adapter migration execution remains unverified.

### Risk-knowledge-specific evidence

Tests exercised:

- public list/detail separation from exact checks and pass/fail criteria
- pagination totals and direct reachability of records 101–108
- all 66 predicates classified with conservative derived/unknown semantics
- unique per-control pass, fail, evidence and retest blocks across all 108 entries
- modified knowledge records and stale evidence-link versions failing closed
- semantic sentence completeness, malformed-template, placeholder, cross-artifact digest and byte-identical regeneration checks
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
- public catalogue null severity returning `context_required` rather than Low
- project `not_evaluated`, `evaluated`, `insufficient_information` and `not_applicable` semantics
- public severity filtering excluding context-required records and explicit `severityStatus` filtering
- rejection of caller-supplied project severity fields and cross-project readiness denial

## Dependency-installation limitation

`npm ci --ignore-scripts` could not complete in this execution environment because the internal package mirror returned HTTP 404 for `xtend@4.0.2`. This is an environment/package-mirror limitation, not evidence that a clean owner-machine installation succeeds. The validation commands above ran using Node built-ins and the source's test adapter; the production `pg` dependency was therefore not exercised against a real database.

## Claims boundary

This record supports an **AgentRiskLayer Security Assessment against AgentRiskLayer Control Profile ARL-RKA-1.2.0**. It is not an accredited certification, legal opinion, proof of compliance, production deployment record or guarantee that the system is risk-free.

The integration is ready for owner-machine comparison, disposable PostgreSQL migration testing, ordinary Git review and controlled deployment verification. It is not represented as pushed, deployed or live.
