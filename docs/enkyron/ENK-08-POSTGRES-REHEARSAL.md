# ENK-08 — PostgreSQL rehearsal: mandatory isolation

## Why this exists

14 isolated contract/mock tests passed on Debian. Those tests DO NOT prove the SQL migration or transaction behavior against PostgreSQL. A new dedicated PostgreSQL integration test now checks the real constraints.

**Blocking safety fix:** the unapplied draft `118_enkyron_psa_mission_planning.sql` lives at `docs/enkyron/sql/118_enkyron_psa_mission_planning.sql`, outside `migrations/`. The `runMigrations` loader auto-applies matching numbered files inside `migrations/` and does not respect `REVIEW ONLY` SQL comments. Do not move this draft into `migrations/` until an approved migration release.

## Safe execution

On Debian 13, run **as the regular operator, never with sudo**:

```bash
pg_virtualenv -v 17 bash scripts/enkyron-psa-virtualenv-rehearsal.sh
```

The launcher refuses port 5432, root execution, and any server whose actual config/data paths do not belong to the `pg_virtualenv` cluster. Only **after** checking the server, it creates synthetic `arl_ci` credentials inside the throw-away cluster. The test uses the dynamically assigned port, refuses unexpected URL overrides and cross-checks server paths before creating any fixture schema. The temporary PostgreSQL cluster is destroyed by `pg_virtualenv` at command exit. No changes to `arl_local` are intended.

The launcher requires an installed Node.js `pg` dependency. Do not use `npm install`, `sudo`, a production connection URL or direct migration commands to work around a failed guard.

Running the integration test directly without a controlled `pg_virtualenv` context will fail closed. **A SKIP is not a PASS.** The launcher supplies `CI=true` and test connection details only inside the disposable process.

The test creates a randomly named `enk08_ci_*` PostgreSQL schema under `arl_ci`, verifies that it is the current schema, creates minimal synthetic CRM fixture tables, executes the review SQL only there, tests data and audit integrity, and drops **only that generated temporary CI schema** afterwards. It never invokes `runMigrations`, and does not open `arl_local`.

## Coverage and limitations

- Covers real PostgreSQL DDL, matching-company foreign keys, cross-workspace access rejection, bounded lists, idempotent retries, concurrent conflict, audit immutability, `planning`-only status and transactional rollback.
- Uses a minimal synthetic CRM fixture, not a clone of the full production migration chain. Passing does not establish compatibility with the entire live schema.
- Does NOT provide user authentication, tenant isolation for a remote service, SOW approval, contract acceptance, permission to security-test, approved production migration, PySide6 UI or Debian operator UAT.

**RELEASE HOLD:** local `arl_local` migration preflight is still STOP (historical applied 021 absent from current source; pending 114, 115, 117). Preserve existing data and do not apply/reconcile any migrations without a reviewed plan and verified restorable backup.
