# ENK-08 — PostgreSQL rehearsal: mandatory isolation

## Why this exists

14 isolated contract/mock tests passed on Debian. Those tests DO NOT prove the SQL migration or transaction behavior against PostgreSQL. A new dedicated PostgreSQL integration test now checks the real constraints.

**Blocking safety fix:** the unapplied draft `118_enkyron_psa_mission_planning.sql` lives at `docs/enkyron/sql/118_enkyron_psa_mission_planning.sql`, outside `migrations/`. The `runMigrations` loader auto-applies matching numbered files inside `migrations/` and does not respect `REVIEW ONLY` SQL comments. Do not move this draft into `migrations/` until an approved migration release.

## Safe execution

Run only with the existing dedicated synthetic PostgreSQL environment:

```bash
CI=true \
ARL_CI_POSTGRES_URL='postgresql://arl_ci:synthetic-ci-only@127.0.0.1:5432/arl_ci' \
node --test tests/enkyron-psa-missions-postgres.test.js
```

These exact database name, role, host, port and password values are test-only fixtures; the test refuses other connection targets, and it refuses unexpected connection-string options. Do not create or modify a CI database merely by guessing credentials. If the dedicated `arl_ci` database is not already provisioned and authorised, obtain a reviewed CI environment first.

Without `ARL_CI_POSTGRES_URL`, Node skips the integration test. **A SKIP is not a PASS.** The `CI=true` flag alone does not enable a connection; the target identity is checked before any write.

The test creates a randomly named `enk08_ci_*` PostgreSQL schema under `arl_ci`, verifies that it is the current schema, creates minimal synthetic CRM fixture tables, executes the review SQL only there, tests data and audit integrity, and drops **only that generated temporary CI schema** afterwards. It never invokes `runMigrations`, and does not open `arl_local`.

## Coverage and limitations

- Covers real PostgreSQL DDL, matching-company foreign keys, cross-workspace access rejection, bounded lists, idempotent retries, concurrent conflict, audit immutability, `planning`-only status and transactional rollback.
- Uses a minimal synthetic CRM fixture, not a clone of the full production migration chain. Passing does not establish compatibility with the entire live schema.
- Does NOT provide user authentication, tenant isolation for a remote service, SOW approval, contract acceptance, permission to security-test, approved production migration, PySide6 UI or Debian operator UAT.

**RELEASE HOLD:** local `arl_local` migration preflight is still STOP (historical applied 021 absent from current source; pending 114, 115, 117). Preserve existing data and do not apply/reconcile any migrations without a reviewed plan and verified restorable backup.
