# Migration to AgentRiskLayer 4.0

## Compatibility

Version 4.0 is an in-place upgrade from 3.0.

Unchanged:

- Stripe products, live Price IDs and webhook;
- Resend configuration;
- custom domain and DNS;
- Render persistent disk and database path;
- session secret and existing accounts;
- assessment, purchase, subscription and inspection data.

New database tables are created automatically:

- `redteam_tokens`
- `redteam_runs`

No new production environment variable is required.

## Deployment

1. Back up `/var/data/agent-risk-layer.sqlite`.
2. Replace the application files with the 4.0 release.
3. Run `npm run validate` locally.
4. Commit and push to the existing GitHub repository.
5. Allow Render to deploy the existing service.
6. Confirm `/api/health` reports version `4.0.0`.
7. Open `/redteam.html`, create a paid Professional assessment, and run the hardened simulation first.
8. Integrate the adapter only with a test or staging deployment.

## Rollback

Rolling the application back to 3.0 leaves the new tables unused. Do not delete the persistent disk. A database backup is still required before migration because the service is handling live customer and payment data.
