# AgentRiskLayer v9.2.0 — Release validation

Generated: 2026-07-30T19:54:10.852Z

## Decision

**Implementation validated; production deployment and verification required.**

The candidate repairs a material approval-integrity trust boundary. Hosted Guard no longer accepts caller-controlled approval booleans as authority. High-impact actions require a server-issued token bound to the exact workspace, project, authoritative environment, tool and canonical arguments. The matching allowed runtime event atomically consumes the approval. Authenticated approver identity remains in the protected ledger and audit trail, while the bearer token omits the internal user identifier.

## Automated evidence

- Complete isolated suite: **157/157 passed**, 0 failed, 0 skipped.
- Focused approval and migration gate: **28/28 passed**.
- End-to-end smoke: owner-issued approval, caller self-assertion denial, changed-value denial, exact allow-and-consume, replay denial, account export and account deletion passed. Focused authorization tests also deny approval issuance by a developer role.
- Syntax and source checks: passed.
- Internal synthetic detection regression: **20/20 passed**, with the stated limited dataset.
- Deterministic safety scenarios: **1,000/1,000 passed**, 0 unsafe deployment decisions.

Evidence files are listed in `RELEASE_VALIDATION.json`.

## Migration and data safety

Migration `008_runtime_approval_integrity.sql` is additive. It creates the approval ledger and indexes without dropping tables, deleting records or rewriting existing customer data. Approver references use `ON DELETE SET NULL` so deletion of an account does not strand a shared project. Approval records are included in account export and terminal records are covered by project retention cleanup.

## Verification limitations

- The gate excluded production database, Stripe, email and Render credentials.
- The live PostgreSQL migration and concurrent approval journey have not been verified in production.
- No deployment was performed from this environment.
- This proprietary validation is not independent certification or a guarantee that AgentRiskLayer is risk-free.

## Production deployment gate

1. Review and commit only the intended v9.2.0 files.
2. Deploy through the existing Render path without changing Stripe, DNS, email or database services.
3. Verify migration 008 is recorded with its checksum.
4. Verify `/api/ready` returns version `9.2.0`, production stage and healthy PostgreSQL.
5. Execute the exact-action approval negative and positive checks in production with synthetic data and a dry-run tool.
6. Review logs, alerts and rollback readiness before recording a deployment decision.
