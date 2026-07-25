# Migration to AgentRiskLayer 4.1

## Compatibility

Version 4.1 is an in-place upgrade from 4.0. Existing Stripe products, live Price IDs, webhook, Resend configuration, custom domain, Render disk, database path, accounts, assessments, purchases, subscriptions, inspections and red-team runs remain compatible.

No new production secret is required.

A new `PRODUCT_STAGE=controlled-beta` variable is included by the Blueprint. When upgrading an existing Render service, add it manually only if Blueprint sync does not add it.

## Database changes

The server automatically adds:

- `redteam_authorisations`
- `redteam_tokens.authorisation_id`
- `redteam_tokens.mode`
- `redteam_runs.authorisation_id`

Existing data remains in place. Always create and verify a backup before deployment.

## Deployment

1. Back up `/var/data/agent-risk-layer.sqlite`.
2. Verify the backup manifest and `PRAGMA quick_check`.
3. Replace the application files with the 4.1 release.
4. Run `npm run validate` locally.
5. Commit and push to the existing GitHub repository.
6. Allow the existing Render service to deploy.
7. Confirm `/api/health` reports `4.1.0` and `productStage: controlled-beta`.
8. Confirm the live Stripe Checkout opens without completing an internal test purchase.
9. Run the built-in hardened simulation first.
10. Create a written Rules of Engagement record before any staging-adapter campaign.

## Rollback

Application rollback to 4.0 leaves the new tables and columns unused. Do not remove the persistent disk. Rules of Engagement created in 4.1 will not be enforceable by the 4.0 code, so do not conduct staging tests while rolled back.
