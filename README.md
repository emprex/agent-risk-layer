# AgentRiskLayer 4.4 — Guided Invitation-Only Beta

AgentRiskLayer is an evidence-led AI-agent security assessment platform. It combines four assurance layers while keeping their trust boundaries explicit:

1. **Declared risk assessment** — 25 controls covering exposure, authority, tools, data, memory, monitoring and incident response.
2. **Read-only local Inspector** — static checks for repository, CI/CD, containers, MCP, dependency and agent-control risks.
3. **Controlled Red Team Runner** — 32 non-destructive attack cases with repeated trials against a simulator or authorised staging adapter.
4. **Professional security report** — deployment decision, attack paths, evidence register, remediation roadmap and retest criteria.

The product stage is **controlled beta**. Active testing is limited to local, test and staging systems with synthetic data, dry-run tools and written Rules of Engagement. Production and destructive testing are refused.

Version 4.3 makes the controlled beta invitation-only. The configured owner is
persisted as a database-backed `superuser`, with Professional report and
controlled-testing access across the owner's workspace. Production owner
operations continue to require verified email and MFA. Twenty expiring,
single-use beta invitations can be created, reserved to an email and revoked
from the owner operations screen.

Version 4.4 adds a searchable, responsive Help Centre and complete user manual.
It documents the end-to-end workflow, evidence ladder, assessment, Inspector,
Red Team, remediation, plans, safety boundaries, troubleshooting and core
AI-agent security vocabulary. Contextual Help links are available throughout
the customer journey.

## What changed in 4.2

Version 4.2 resolves all six blockers from the independent v4.1 audit:

- **Durable payment fulfilment:** purchases now move through recorded fulfilment states, paid access is granted transactionally, failed PDF/email work is retried with backoff, dead-lettered jobs create operational alerts, and administrators can reconcile incomplete purchases.
- **Complete report delivery:** downloaded and emailed reports use the same report service and include the latest Inspector and Red Team evidence.
- **Persistent trusted-proxy rate limiting:** limits are stored in SQLite, client identity uses the trusted right-most proxy chain rather than spoofable left-most forwarding values, and repeated abuse receives progressive penalties.
- **Enforced evidence retention:** expired red-team evidence is purged automatically, deletion receipts are retained, and explicit legal holds prevent deletion while remaining visible to operators.
- **Strict authorisation windows:** staging evidence is accepted only when its recorded start and completion fall inside the approved Rules of Engagement window, with a five-minute clock-skew allowance.
- **Honest Agency positioning:** unsupported team/client-workspace claims were removed. The current Agency product offers a multi-assessment portfolio in one secured account.

Additional hardening includes:

- Asynchronous scrypt password verification to avoid blocking the Node event loop.
- Verified-email gates for payments, Inspector uploads and Red Team campaigns.
- Optional TOTP MFA with one-time recovery codes.
- Recent-password/MFA reauthentication for destructive account actions.
- Idle and absolute session expiry.
- Admin MFA enforcement in production.
- Strict CSP without `unsafe-inline` and removal of inline style attributes.
- Backup checksum verification, atomic restore tooling and automated retention.
- Owner operations view for fulfilment failures, retention activity and unresolved alerts.
- Exact Node container tag for reproducible builds.

## Customer journey

1. Complete the free evidence-aware assessment.
2. Verify the account email and save the result.
3. Run the Inspector locally against an authorised repository.
4. Upload the signed, redacted evidence bundle with a one-time token.
5. Purchase a report or use an eligible subscription.
6. For staging testing, create written Rules of Engagement.
7. Run the signed customer-side runner against a simulator or staging adapter.
8. Review declared, observed and reproduced findings separately.
9. Remediate and rerun to compare new, resolved and unchanged findings.

## Run locally

Node **22.5 or newer** is required. There are no external runtime npm dependencies.

```bash
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

Run the complete release validation:

```bash
npm run validate
```

## Local Inspector

```bash
node inspector/agent-risk-inspector.mjs scan . \
  --authorised \
  --environment test \
  --out agentrisk-inspection.json
```

Use `.agentrisk.json` for exclusions, accepted-risk reviews and named false-positive reviews. Reviews require a reason, accountable owner and expiry date. Suppressed findings remain in the evidence bundle but do not inflate technical risk.

## Controlled Red Team Runner

Simulation:

```bash
node redteam/agent-risk-redteam.mjs run \
  --authorised \
  --environment test \
  --profile hardened \
  --trials 5 \
  --out agentrisk-redteam.json
```

Authorised staging campaign:

```bash
ARL_TARGET_TOKEN=... node redteam/agent-risk-redteam.mjs run \
  --authorised \
  --environment staging \
  --endpoint https://staging.example.com/agentrisklayer/evaluate \
  --auth-env ARL_TARGET_TOKEN \
  --authorisation-id roe_... \
  --trials 3 \
  --upload https://agentrisklayer.com \
  --token red_... \
  --out agentrisk-redteam.json
```

The adapter contract is documented in [REDTEAM_ADAPTER_PROTOCOL.md](REDTEAM_ADAPTER_PROTOCOL.md).

## Backup and restore

Create a consistent SQLite backup:

```bash
DATABASE_PATH=/var/data/agent-risk-layer.sqlite \
BACKUP_RETENTION_DAYS=30 \
npm run db:backup -- /var/data/backups/agentrisklayer.sqlite
```

Verify it:

```bash
npm run db:verify-backup -- /var/data/backups/agentrisklayer.sqlite
```

Restore to a separate path first:

```bash
npm run db:restore -- \
  /var/data/backups/agentrisklayer.sqlite \
  /var/data/restore-drill.sqlite
```

The restore command validates the manifest checksum and SQLite `quick_check`, copies atomically and refuses to overwrite an existing database unless `--force` is supplied during a controlled maintenance window.

## Production configuration

```dotenv
NODE_ENV=production
PRODUCT_STAGE=controlled-beta
BASE_URL=https://agentrisklayer.com
DATABASE_PATH=/var/data/agent-risk-layer.sqlite
SESSION_SECRET=...
SESSION_IDLE_HOURS=12
SESSION_ABSOLUTE_DAYS=7
EMAIL_VERIFICATION_HOURS=24
TRUSTED_PROXY_HOPS=1
FULFILMENT_WORKER_INTERVAL_MS=15000
RETENTION_WORKER_INTERVAL_MS=3600000
BACKUP_RETENTION_DAYS=30
STRIPE_SECRET_KEY=sk_live_...
STRIPE_API_VERSION=2026-06-24.dahlia
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC_REPORT=price_...
STRIPE_PRICE_PRO_REPORT=price_...
STRIPE_PRICE_DEVELOPER_MONTHLY=price_...
STRIPE_PRICE_AGENCY_MONTHLY=price_...
RESEND_API_KEY=re_...
EMAIL_FROM=AgentRiskLayer <reports@agentrisklayer.com>
ADMIN_EMAIL=...
SUPPORT_EMAIL=...
COMPANY_LEGAL_NAME=...
COMPANY_ADDRESS=...
```

Existing Stripe, Resend, DNS and Price IDs remain compatible with the v4.2 in-place upgrade.

To create or reuse the new v4.3 prices and update these four values on Render,
use the included updater:

```bash
export STRIPE_SECRET_KEY='sk_...'
export RENDER_API_KEY='rnd_...'
export RENDER_SERVICE_ID='srv-...'
npm run prices:update                 # dry run
npm run prices:update -- --apply      # update prices and Render
npm run prices:update -- --apply --deploy
```

The updater never saves or prints the API keys. Use Stripe test credentials
first when validating against the sandbox.

## Product routes

```text
/                         Commercial landing page
/assessment.html          Evidence-aware questionnaire
/inspector.html           Private static-inspection workspace
/redteam.html             Private campaign and authorisation workspace
/methodology.html          Scoring, evidence and test methodology
/trust.html                Trust centre and assurance boundaries
/sample-report.html        Professional sample report
/pricing.html              Reports and subscriptions
/dashboard.html            Customer workspace and security settings
/admin.html                Owner analytics, alerts and reconciliation
/verify.html               Email verification
/api/health                Health and deployed version
```

## Trust boundary

AgentRiskLayer does not claim that:

- A questionnaire answer is technically verified.
- A static scan proves runtime or cloud security.
- A customer-operated signature proves independent custody.
- A passing case proves the entire system is secure.
- A controlled campaign is an independent penetration test.
- A score is a breach probability, certification or guarantee.

## Release evidence

See:

- [VALIDATION.md](VALIDATION.md)
- [SECURITY.md](SECURITY.md)
- [MIGRATION_V4_2.md](MIGRATION_V4_2.md)
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [ASVS_5_CHECKLIST.md](ASVS_5_CHECKLIST.md)
- [ACCESSIBILITY_AUDIT.md](ACCESSIBILITY_AUDIT.md)

External penetration testing, legal review and real-customer outcome evidence remain required before enterprise-grade or independently audited claims are made.
