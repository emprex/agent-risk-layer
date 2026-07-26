# AgentRiskLayer v9 operations runbook

## Daily

- Check Render status, `/api/ready`, deployment logs and open operational alerts.
- Check protected `/metrics` for request volume, runtime denies, project growth, open remediation and memory/uptime anomalies.
- Review Stripe webhook failures, incomplete purchases and Resend delivery failures.
- Confirm PostgreSQL connections, storage and managed backup status.
- Review unusual Guard authentication/rate-limit activity without logging project secrets.

## Weekly

- Create an independent PostgreSQL archive and run `npm run db:verify-backup`.
- Review control-plane quota use, denied decisions, risky inventory drift and overdue remediation.
- Review beta invitation use, owner/admin activity, key revocations and integration failures.
- Run one sandbox payment and one transactional email after payment/email configuration changes.

## Monthly

- Restore the latest verified archive into a non-production PostgreSQL database.
- Record restore duration, archive digest, migration state, table counts and functional smoke results.
- Review account/workspace access, SCIM tokens, project keys, integration secrets and GitHub/Render membership.
- Rotate credentials on schedule or immediately after suspected disclosure.
- Patch the Node base image and dependencies only after full validation.

## Runtime-control incident

1. Put affected projects into enforce mode or revoke exposed keys.
2. Fail closed for high-impact actions while integrity is uncertain.
3. Preserve privacy-safe runtime evidence, audit history and database recovery points.
4. Compare inventory snapshots and identify new agents/tools/MCP servers/models.
5. Assign remediation with owner, severity and due date.
6. Retest and verify before reopening deployment gates.
7. Notify affected customers according to the approved incident process.

## Payment/email incident

- Disable checkout or fulfilment if webhook integrity is uncertain.
- Never fulfil from a browser redirect alone; reconcile against signed Stripe events.
- Retry transactional email from the recorded fulfilment state without duplicating purchases.

## Database recovery

- Prefer Render-managed point-in-time recovery where available.
- Verify independent `.dump` archives before restoration.
- Restore to a new database first; never test restoration against production.
- Require `--force`, an approved maintenance window and separately supplied `RESTORE_DATABASE_URL`.
- Re-run migrations, `/api/ready`, the full smoke journey and business reconciliation before routing traffic.

## Graceful shutdown

Render `SIGTERM` stops accepting new HTTP connections, waits for in-flight work and closes the PostgreSQL pool. The process forces termination after ten seconds if shutdown cannot complete.
