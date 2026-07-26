# AgentRiskLayer v9.0.0 — Definitive internal release validation

**Status:** deployment package ready for controlled-beta live verification.

This record describes executable engineering validation performed on the v9 hosted security-control-plane release. It is not an independent penetration test, certification, compliance attestation, customer case study, or production operating history.

## Final release gate

| Gate | Result |
|---|---:|
| Automated tests | **86/86 passed** |
| PostgreSQL adapter, transaction, migration and infrastructure contracts | **Passed** |
| PostgreSQL backup and restore contracts | **2/2 passed** |
| JavaScript syntax audit | **Passed** |
| Complete customer, payment, workspace and security smoke journey | **Passed** |
| Hosted Guard enforcement journey | **Passed** |
| Labelled detection benchmark | **20/20 passed** |
| False positives / false negatives | **0 / 0** on the limited synthetic dataset |
| Deterministic safety scenarios | **1,000/1,000 passed** |
| Unsafe scenario decisions | **0** |
| Controlled red-team simulation | **32/32 passed** |
| Local load requests | **5,000/5,000 succeeded** |
| Local load errors | **0** |
| Local throughput | **2,511.7 requests/second** |
| Local p50 / p95 / p99 latency | **32.1 / 76.4 / 148.4 ms** |
| Stripe and Render price update dry run | **Passed** |
| AgentRisk Inspector self-scan | **100/100, grade A, 0 active findings** |

The load scope was 100 virtual users × 50 requests using mixed public reads and per-user CSRF/session traffic. It did not include real Stripe, Resend, Render, DNS or PostgreSQL network calls.

## Product journey proved

The smoke journey completed:

- registration, email verification, authentication, sessions and CSRF;
- a scored assessment, £99 one-off purchase, £29 subscription and protected PDF fulfilment;
- private/public token isolation, data export and password recovery;
- signed local inspection, replay rejection, server-side recalculation and retest comparison;
- controlled red teaming with Rules of Engagement, repeated trials and replay rejection;
- workspace creation and safe deletion of an account that owns its sole workspace;
- production security-project creation, one-time API-key issuance and immediate revocation;
- hosted `/v1/guard` allow, deny and replay-safe decisions;
- privacy-safe runtime evidence that excludes raw prompts, outputs and tool arguments;
- inventory snapshots, privileged drift review gates and owned remediation verification.

The isolated smoke ledger recorded two fulfilled purchases, £128.00 simulated revenue, one active subscription, three inspections, two red-team runs and zero open alerts.

## Hosted control-plane controls

- Production and staging projects default to enforcement mode rather than passive monitoring.
- API keys are scoped, displayed once, stored as hashes and immediately revocable.
- Request IDs are replay-safe and decisions are auditable.
- Authentication abuse, per-key bursts and monthly usage are server-enforced.
- Community includes one project, two keys, seven-day event retention and 10,000 Guard decisions per month.
- Billing entitlements resolve through the workspace billing owner so members cannot bypass limits.
- Denied events can produce signed workspace integration notifications.
- Inventory drift can require deployment review when privileged exposure changes.
- Remediation records include owner, severity, due date, status and verification evidence.
- Prometheus metrics require a separate production token.

## PostgreSQL and recovery controls

- Production requires `DATABASE_URL` and rejects SQLite, MySQL, file and local-only persistence URLs.
- Three PostgreSQL-native migrations run under an advisory lock and are recorded with SHA-256 checksums.
- Critical multi-step writes use connection-bound transactions.
- The Render Blueprint provisions PostgreSQL 18 with a 1 GB database plan, 25 GB disk and storage autoscaling; the application has no persistent disk.
- `/api/health` is process liveness; `/api/ready` requires database connectivity and complete production configuration.
- Backups use custom-format `pg_dump`; verification uses SHA-256 and `pg_restore --list`; restore requires `--force` and a separately supplied destination URL.
- Database URLs are passed to PostgreSQL tools through process environment variables rather than command-line arguments.

## Security evidence

AgentRisk Inspector 4.0.0 evaluated 27 deterministic rules and reported posture **100/100**, grade **A**, technical risk **0/100** and zero active findings. One credential-shaped string in `inspector.test.js` remains visible as a named, expiring false-positive review because it is an intentionally invalid regression fixture. The evidence bundle digest is `15a95cb1bb2c2512f93d9aa110da499832d44b35a4d83fa79c1f1045f47153e0`.

The controlled hardened red-team simulation passed **32/32** single-trial synthetic cases across prompt injection, sensitive-data disclosure, tool misuse, memory security, MCP/supply chain, output handling, authorisation, resource controls and retrieval security. High-assurance claims require repeated live-target trials under written authorisation.

## Commercial configuration validated

- Community: **£0**, one project and 10,000 Guard decisions/month.
- Founding Security Assessment: **£99 once**.
- Developer: **£29/month**.
- Team: **£99/month**.
- Agency: **£249/month**.
- Enterprise: **from £6,000/year**.

The price-update command completed in dry-run mode and changed no external system. The release uses v9-specific Stripe lookup keys.

## Live checks that cannot be manufactured in source code

Before controlled-beta invitations are sent, the owner-controlled deployment must prove:

1. Render creates the paid web service and managed PostgreSQL database, all three migrations complete, and `/api/ready` returns HTTP 200.
2. A real PostgreSQL backup, checksum verification and owner-approved restore drill complete.
3. Live Stripe prices, Checkout, webhook signatures, fulfilment, billing portal and cancellation complete.
4. Resend registration, reset, security and report-delivery emails arrive from the verified production domain.
5. Namecheap DNS, TLS, security headers, canonical URLs, monitoring and analytics are verified.
6. Desktop and mobile journeys work against the live service.
7. Operational alerts and recovery contacts reach the correct owner.

## Evidence boundary

The complete smoke and load journeys use the isolated test-only compatibility adapter. PostgreSQL behaviour is covered by executable adapter, transaction, migration, infrastructure and backup/restore contracts, but no owner-controlled managed PostgreSQL server was supplied to this environment. No real customer traffic, live payment, live email or independent adversarial assessment is claimed.
