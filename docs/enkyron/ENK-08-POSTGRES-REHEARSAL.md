# ENK-08 — PostgreSQL rehearsal: mandatory isolation

## Why this exists

14 isolated contract/mock tests passed on Debian. Those tests DO NOT prove the SQL migration or transaction behavior against PostgreSQL. A new dedicated PostgreSQL integration test now checks the real constraints.

**Blocking safety fix:** the unapplied draft `118_enkyron_psa_mission_planning.sql` lives at `docs/enkyron/sql/118_enkyron_psa_mission_planning.sql`, outside `migrations/`. The `runMigrations` loader auto-applies matching numbered files inside `migrations/` and does not respect `REVIEW ONLY` SQL comments. Do not move this draft into `migrations/` until an approved migration release.

## Safe execution

On Debian 13, run **as the regular operator, never with sudo**:

```bash
pg_virtualenv -v 17 bash scripts/enkyron-psa-virtualenv-rehearsal.sh
```

The launcher refuses port 5432, root execution, and any server whose actual config/data paths do not belong to the `pg_virtualenv` cluster. Only **after** checking the server, it creates synthetic `arl_ci` credentials inside the throw-away cluster. The **launcher** checks the privileged `config_file` and `data_directory` settings with the ephemeral cluster's administrative account; the unprivileged Node.js test checks only database, role, address and dynamic port. We deliberately do **not** grant `pg_read_all_settings` to `arl_ci`. The test also refuses unexpected URL overrides. The temporary PostgreSQL cluster is destroyed by `pg_virtualenv` at command exit. No changes to `arl_local` are intended.

The initial real PostgreSQL rehearsal on 16 November 2026 stopped safely with SQLSTATE `42501` because the unprivileged `arl_ci` role tried to inspect `config_file`; 14 mock/contract tests passed, while the database test failed before any synthetic fixture schema was created. This corrective commit removes that inappropriate privilege request; PostgreSQL integration must still be rerun.

The launcher requires an installed Node.js `pg` dependency. Do not use `npm install`, `sudo`, a production connection URL or direct migration commands to work around a failed guard.

Running the integration test directly without a controlled `pg_virtualenv` context will fail closed. **A SKIP is not a PASS.** The launcher supplies `CI=true` and test connection details only inside the disposable process.

The test creates a randomly named `enk08_ci_*` PostgreSQL schema under `arl_ci`, verifies that it is the current schema, creates minimal synthetic CRM fixture tables, executes the review SQL only there, tests data and audit integrity, and drops **only that generated temporary CI schema** afterwards. It never invokes `runMigrations`, and does not open `arl_local`.

## Coverage and limitations

- Covers real PostgreSQL DDL, matching-company foreign keys, cross-workspace access rejection, bounded lists, idempotent retries, concurrent conflict, audit immutability, `planning`-only status and transactional rollback.
- Uses a minimal synthetic CRM fixture, not a clone of the full production migration chain. Passing does not establish compatibility with the entire live schema.
- Does NOT provide user authentication, tenant isolation for a remote service, SOW approval, contract acceptance, permission to security-test, approved production migration, PySide6 UI or Debian operator UAT.

**RELEASE HOLD:** local `arl_local` migration preflight is still STOP (historical applied 021 absent from current source; pending 114, 115, 117). Preserve existing data and do not apply/reconcile any migrations without a reviewed plan and verified restorable backup.
