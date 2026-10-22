# ARL safe cleanup and Operator baseline — 22 October 2026

**Status:** source-level, read-only inventory followed by a tiny isolated CLI proposal. Not a production readiness decision, deployment approval, customer audit, or completed A–Z acceptance test.

## Frozen inspection point

- Canonical repository: `emprex/agent-risk-layer`
- Inspected default branch: `main`
- Git SHA: `221120b82e03c84aef6deaad2458fec1dedd71ec`
- Manifest: AgentRiskLayer `10.1.1`, Node.js `24.21.0`, PostgreSQL `pg` dependency.
- Existing CLI binary: `bin/arl-operator.mjs` delegates to `src/agent/arl-local-assessment-runner.mjs`.
- Existing local Operator: `npm run assess:local` (transactional) and `npm run operator:open` (private offline dashboard export).
- Scope observed: repository contents and selected implementation/docs. Debian machine, local PostgreSQL, private assessment records, secrets and customer targets were **not** inspected.

## Non-negotiable preservation rules

1. No deletion, reset, history rewrite, dependency upgrades, database migrations, deployment or target probes as part of this inventory.
2. Preserve `data/`, `test-artifacts/`, `migrations/`, evidence hashes and all snapshot/retest lineage. Generated and historical artifacts are not disposable merely because they are old.
3. Never mutate the historical frozen target. A Git SHA change or material scope change forces explicit revalidation of dependent evidence.
4. Never treat the HTML dossier or a CLI diagnostic as permission to run tests or as a security finding.
5. No automatic human applicability, finding validity, severity, closure, readiness, or deployment decisions.
6. Do not merge overlapping Operator changes without reconciling their scope and exact-head tests.

## Existing work that must not be overwritten

At the inspection point, **draft PR #488** addresses safe existing-only Operator opening, and **draft PR #489** addresses effective-evidence readiness. Both are separate from this CLI convenience change. Additional open KB and dependency PRs exist. Review each before merging any overlapping change.

The established `docs/OPERATOR_AZ_CAPABILITY_MAP.md` already documents the gap between a static review dashboard and a complete transaction-capable graphical interface. Reuse that plan, not a second backend or engine.

## Cleanup candidates (NOT proven unused)

| Candidate | Observation | Required proof before any removal/refactor |
| --- | --- | --- |
| `server.js` | Roughly 122 KB single entry file | Map imports, routes, runtime behaviour, API tests and static-site dependencies |
| `src/agent/local-assessment-workflow.mjs` | Roughly 163 KB | Map authoritative functions, state transitions, decision gates and PostgreSQL tests |
| `public/*fix*.css` and `public/*fix*.js` | Several layered UX adjustment files | Trace HTML/script/style references, reachable routes, browser regressions and responsive/accessibility behaviour |
| Multiple historical release notes and benchmark results | Versioned records live at root and in `test-artifacts/` | Check retention obligations, published links, release provenance and exact tests consuming them |
| Operator entry points and docs | Current binary is a thin runner delegation; offline HTML is read-only | Confirm current call paths and existing PR #488 before consolidating |

None of these observations justify deleting a file today.

## Small safe CLI block in the proposed branch

- Add `arl-operator --help`, `arl-operator --version`, and `arl-operator doctor`.
- Information commands are local/read-only: no database connection, no assessment runner import, no target selection, no network probes.
- Diagnostic inspects only package version, Node version, current Git SHA/worktree status and whether `.env` exists; it does **not** read `.env` contents or claim PostgreSQL readiness.
- Existing positional assessment invocation is delegated unchanged to the canonical runner.
- Regression tests cover no-runner informational commands, secret-safe output, invalid extra arguments and exact git-read boundaries.

This block is **not** a graphical interface. It is a low-risk first usability and troubleshooting step.

## Next smallest GUI block (separate PR)

After reconciling existing PR #488 and verifying the current dashboard implementation, add one **read-only next-action view** to the canonical offline Operator dossier using the already-frozen snapshot and work queue. It must display limits clearly, never present an unreviewed control as PASS, and never allow browser-driven state mutation or active testing. Only after that should a local authenticated transaction interface be designed with actor identity, CSRF, per-action confirmation and authoritative audit records.

## Required acceptance before any merge

- `npm run check`, `npm run lint`, `npm test`, and relevant focused tests run on the *exact branch head* in CI.
- Review changed files and `git diff --check` / equivalent whitespace verification.
- Confirm no modification of `main`, migration files, database, generated evidence, tests' historical snapshots, or production target.
- Human review remains required; leave the proposal as a draft PR until proven safe.
