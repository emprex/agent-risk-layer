# Risk knowledge repository integration record

## Control Intelligence integration

`security_projects` → immutable `system_snapshots` → `control_snapshot_evaluations` → canonical `risk_knowledge_checks` → `control_test_executions` → `control_evidence_items` → existing remediation/runtime/approval/retest records → `control_deployment_decisions`.

The derived service is `src/control-intelligence.js`; authenticated routes are in `server.js`; accessible overview/detail surfaces are `public/control-intelligence*`. Existing workspace roles, CSRF, sessions, audit, runtime approval integrity, remediation transitions, retention and Risk Knowledge digest verification remain authoritative.

## Inspected baseline

- Source archive: `agent-risk-layer-fix-main.zip`
- Verified repository baseline: commit `02271bf`
- Local inspection repository: `/home/guillaume/agent-risk-layer-fix`
- Existing latest migration before this change: `012_seed_risk_knowledge_v1_1.sql`
- Application shape: Node.js HTTP server, PostgreSQL production adapter, isolated SQLite test adapter, existing workspace/project roles and evidence workflow

The source archive contains committed files only. It does not prove the state of the live Render service or any uncommitted work on the owner’s Debian machine.

## Integrated database changes

- `migrations/009_risk_knowledge_asset.sql`
- `migrations/010_seed_risk_knowledge_v1.sql`
- `migrations/011_risk_knowledge_v1_1.sql`
- `migrations/012_seed_risk_knowledge_v1_1.sql`
- `migrations/013_risk_knowledge_evidence_lifecycle.sql`
- `migrations/014_seed_risk_knowledge_v1_2.sql`

The migrations are additive. Seed transaction-control statements were removed because the existing PostgreSQL migration runner already wraps the complete migration sequence in one advisory-lock transaction. Tests reject future top-level `BEGIN`, `COMMIT` or `ROLLBACK` statements in migration files.

Created structures:

- versioned entries, checks, solutions, references and informative mappings
- tenant/project-bound knowledge links
- structured applicability predicates
- operational metadata
- per-project evidence-readiness state
- lifecycle review records, a predicate provenance registry and contextual project-risk records

## Integrated server and service changes

- `src/risk-knowledge-core.js`
- `src/risk-knowledge.js`
- `src/risk-knowledge-subjects.js`
- public-safe, verified-detail, export, profiler, project-profile, evidence-link, state and readiness routes in `server.js`
- account export of risk states and links
- retention-safe link removal and evidence invalidation in `src/retention.js` and `src/control-plane.js`
- SQLite test schema/seed loading in `src/db-adapters/sqlite-local.js`

The implementation preserves existing findings, remediation, runtime events, approvals, evidence artefacts and retest tables. It links them to a versioned knowledge entry instead of creating a second findings database.

## Integrated customer experience

- `/risk-library.html` — public searchable explorer
- `/risk-library-detail.html` — public problem/control boundary with verified-account detailed evidence access
- `/risk-profiler.html` — tri-state architecture profiler; public answers are not retained
- `/risk-readiness.html` — authenticated, project-bound Evidence Readiness view
- Risk Library links in the public footer and Trust Centre
- project Evidence Readiness links in the authenticated dashboard
- public library and profiler in the generated sitemap; readiness remains `noindex`
- privacy notice updated for saved architecture applicability outcomes, evidence links and digests

## Evidence and authorization boundaries

- Exact checks and pass/fail criteria require a verified account.
- Project writes reuse the existing project role service and global CSRF control.
- Workspace and user identifiers from request bodies are rejected.
- Linked subjects are resolved server-side and fail closed when not project-bound.
- Evidence counts and deployment gates are server-derived.
- Generic artefacts cannot claim `test_passed`.
- Runtime action approvals cannot claim `risk_accepted`.
- Retest links require completed, passed, exact criteria-bound runtime evidence.
- Retention cannot silently turn an open critical finding into a passing state.

## Validation boundary

Local validation exercises the SQLite compatibility adapter, fake PostgreSQL adapter/migration runner, HTTP routes, authorization, retention, public experience and complete existing regression suite. A live PostgreSQL instance, Render configuration, Stripe/Resend journeys, production migration, push and deployed website were not available from the uploaded archive and remain unverified.

## Deployment sequence still required on the owner machine

1. Compare this integrated archive/patch against the current `/home/guillaume/agent-risk-layer-fix` branch and preserve any newer work.
2. Install locked dependencies and rerun `npm run check`, `npm test`, `npm run validate`, smoke, scenario and load gates.
3. Run migrations against a disposable PostgreSQL database and verify rollback/restore before production.
4. Review the intended diff and secret scan; stage only intended files.
5. Commit, pull with rebase, push through the existing HTTPS token workflow and verify the remote commit.
6. Verify Render readiness reports migrations 009–014 and test the public, authenticated and cross-tenant journeys in production.
