# Migration to AgentRiskLayer 4.2

Version 4.2 is an in-place upgrade from 4.1 and preserves existing accounts, assessments, purchases, Stripe configuration, Resend configuration and the Render persistent database.

## Before deployment

1. Put the service into a short maintenance window.
2. Create and verify a database backup.
3. Confirm the backup manifest checksum and `quick_check: ok`.
4. Keep the current release available for rollback.

## New optional environment variables

The release has safe defaults, but production should explicitly set:

```dotenv
SESSION_IDLE_HOURS=12
SESSION_ABSOLUTE_DAYS=7
EMAIL_VERIFICATION_HOURS=24
TRUSTED_PROXY_HOPS=1
FULFILMENT_WORKER_INTERVAL_MS=15000
RETENTION_WORKER_INTERVAL_MS=3600000
BACKUP_RETENTION_DAYS=30
```

On Render, `TRUSTED_PROXY_HOPS=1` means the application trusts the platform-injected right-most forwarding hop and does not use a spoofable left-most value.

## Database migration

New tables and columns are created automatically during application startup. The migration is additive. Do not create a new database or Render service.

## Deployment

```bash
npm run validate
git add agent-risk-layer
git commit -m "Launch AgentRiskLayer 4.2 reliability hardening"
git push origin main
```

After Render reports Live:

```bash
curl https://agentrisklayer.com/api/health
```

Expected version: `4.2.0`.

## Post-deployment checks

- Verify an existing account can sign in.
- Verify the email-verification workflow.
- Enable MFA on the administrator account before using `/admin.html` in production.
- Open the admin operations view and confirm there are no unresolved critical alerts.
- Create a sandbox/test purchase in a non-live environment and simulate an email failure/retry.
- Confirm PDF download and email use the same evidence snapshot.
- Create a short Rules of Engagement record and verify out-of-window evidence is rejected.
- Run the retention worker against a test record and verify a purge receipt is created.
- Perform a restore drill to a separate database path.

## Rollback

If startup or migration fails:

1. Stop the new service.
2. Redeploy the prior commit.
3. Restore the verified pre-upgrade backup only if the existing database cannot open or the migration caused corruption.
4. Record the incident and preserve logs before deleting failed artifacts.
