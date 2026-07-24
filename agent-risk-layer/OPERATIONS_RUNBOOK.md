# AgentRiskLayer 4.2 Operations Runbook

## Daily checks

- `/api/health` reports `ok: true` and version `4.2.0`.
- Render service is Live and the persistent disk is mounted.
- Owner dashboard shows no unresolved critical operational alerts.
- Stripe webhook deliveries return HTTP 200.
- Fulfilment jobs are not accumulating in retrying or dead-letter states.
- Resend delivery failures are investigated and retried.

## Paid customer reports

A paid purchase is healthy when:

1. The purchase is recorded as paid.
2. Access is granted.
3. The report snapshot is generated.
4. The PDF/email job is completed or deliberately retried.
5. The customer dashboard displays delivery status.

For an incomplete purchase, open `/admin.html`, inspect the alert and use reconciliation. Never edit the database manually while the service is running.

## Fulfilment incident

1. Confirm the Stripe Checkout Session is paid in Stripe.
2. Confirm the local purchase/session identifiers match.
3. Review the fulfilment job error and attempt count.
4. Fix the root cause, such as Resend configuration or storage access.
5. Trigger reconciliation.
6. Confirm report access and delivery.
7. Close the operational alert with an incident note.

## Evidence retention

The retention worker runs periodically and on startup. Expired red-team evidence is deleted and a non-sensitive receipt is retained. A legal hold blocks deletion and must include an accountable decision outside the application.

Review legal holds at least monthly. Remove a hold only after written authorisation.

## Backup schedule

- Daily automated backup to `/var/data/backups`.
- Retain at least 30 days or the legally approved period.
- Verify every backup’s checksum and SQLite `quick_check`.
- Perform a restore drill at least monthly to a separate path.
- Never restore over the live database without maintenance mode and a rollback copy.

## Key rotation

Rotate immediately after suspected disclosure and at the organisation’s chosen periodic interval:

- Stripe secret and webhook secret
- Resend API key
- Render deploy hook
- Session secret only with an accepted consequence that all sessions and encrypted MFA secrets require a controlled migration/reset

## Incident severity

- **Critical:** unauthorised access, secret exposure, payment access not granted, evidence scope breach.
- **High:** repeated delivery failure, retention failure, broken MFA/admin protection.
- **Medium:** isolated report-generation failure, non-sensitive monitoring gap.
- **Low:** cosmetic or informational issue without security/customer impact.

## Emergency actions

- Enable Render maintenance mode.
- Revoke affected external credentials.
- Preserve logs and database backup.
- Stop Red Team token issuance if authorisation integrity is uncertain.
- Notify affected customers and regulators when legally required.
