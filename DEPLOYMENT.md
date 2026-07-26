# AgentRiskLayer v9 production deployment

## 1. Repository and Render Blueprint

1. Put the definitive package at the GitHub repository root.
2. Confirm `render.yaml`, `Dockerfile`, `package-lock.json`, `migrations/`, `server.js` and `src/control-plane.js` are committed.
3. Create a Render Blueprint from the repository.
4. Confirm it provisions the paid `agent-risk-layer` web service and `agent-risk-layer-db` managed PostgreSQL service in Frankfurt.
5. Confirm the web service has no persistent disk and receives the database private connection string as `DATABASE_URL`.

## 2. Owner-controlled variables

Set every `sync: false` value in Render. Values for legal identity, jurisdiction, support, payments and email must be factual. Production startup refuses incomplete configuration.

Create/update the Stripe catalogue only with owner-controlled credentials:

```bash
STRIPE_SECRET_KEY=... RENDER_API_KEY=... RENDER_SERVICE_ID=srv-... \
  npm run prices:update -- --apply
```

Review all products and prices in Stripe before adding `--deploy`.

## 3. First deployment

The application will:

1. validate production configuration and fail closed if unsafe;
2. connect to managed PostgreSQL;
3. acquire the migration advisory lock;
4. apply checksum-recorded migrations, including the security control plane;
5. clean expired credentials and enforce retention;
6. start fulfilment and retention workers;
7. expose `/api/ready` only after database and configuration checks pass.

Check Render logs for `server_started`, the applied migration list and no unresolved operational alert.

## 4. External services

- Stripe webhook: `https://agentrisklayer.com/api/stripe/webhook`
- Resend sender: verified address on `agentrisklayer.com`
- DNS: use the exact Render custom-domain records
- HTTPS: wait for Render certificate issuance before customer traffic
- Metrics: configure the monitoring service to call `/metrics` with `METRICS_TOKEN`

## 5. Live controlled-beta journey

Use dedicated test identities and synthetic content. Verify:

1. invitation-bound registration, verification, MFA and recovery;
2. free Community project creation and one-time API key display;
3. Guard allow, deny, monitor, replay and revoked-key behaviour;
4. project quota and burst-rate responses, including `Retry-After`;
5. inventory baseline, risky drift and `review-required` gate;
6. remediation assignment, status changes and verification evidence;
7. assessment, £99 checkout, Stripe webhook and idempotent fulfilment;
8. Developer/Team/Agency checkout, billing portal and cancellation;
9. Resend report delivery and failure/retry handling;
10. inspector and red-team token upload, replay rejection and signed evidence;
11. workspace role isolation, owner billing limits and SCIM provisioning;
12. protected metrics, health/readiness and alert visibility;
13. export and account deletion with owned projects/workspaces;
14. desktop and mobile navigation, dashboard, control plane and checkout;
15. PostgreSQL backup, checksum verification and restore into a separate non-production database.

Record IDs, timestamps and outcomes without copying secrets, raw customer prompts or payment data.
