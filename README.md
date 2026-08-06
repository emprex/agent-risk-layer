# AgentRiskLayer v10.1.1

AgentRiskLayer is an evidence-first AI-agent security control plane for teams that need to discover AI assets, inspect code and model artefacts, test agent behaviour, enforce runtime policy, assign remediation, and make a defensible deployment decision from one auditable workflow.

This release is the production package for public self-service onboarding. Production uses Render Managed PostgreSQL through `DATABASE_URL`; there is no filesystem database or application disk.

## Human-centred experience

The public website and authenticated workspace now organise the complete platform around customer questions and one recommended next action. Advanced runtime, inspection, red-team, approval, inventory, remediation, retest and audit capabilities remain available through progressive disclosure. See `UX_AUDIT_V10.md` and `CUSTOMER_JOURNEY_V10.md`.

## What is included

- **Hosted security control plane:** scoped projects, versioned policy, one-time API keys, immediate revocation, server-side plan quotas, runtime decisions, privacy-safe event evidence and audit history.
- **Hosted Guard API:** `POST /v1/guard` screens prompt/input, output and tool-call metadata in monitor or enforce mode. Production, staging and test projects default to enforcement.
- **AI asset inventory and drift:** agents, models, MCP servers, tools, gateways and vector stores can be recorded as signed snapshots. Risky drift changes the deployment gate to `review-required`.
- **Remediation ownership:** severity, owner, due date, status and evidence-based verification are recorded against each project.
- **Technical inspection:** 27 deterministic rules, model digest and provenance checks, bounded SafeTensors validation and rejection of unsafe executable model formats.
- **Controlled red teaming:** 32 non-destructive cases, repeated/adaptive trials, written Rules of Engagement and signed redacted evidence.
- **Local runtime gateway:** customer-operated enforcement is available where content must remain entirely inside the customer boundary.
- **Enterprise foundations:** workspaces, five roles, MFA, SCIM, signed HTTPS/Slack/Jira/CEF/OCSF/SARIF outputs and tenant isolation.
- **Risk knowledge and Evidence Readiness:** 108 versioned AI-agent risk entries connect a problem to a bounded check and remediation, with tri-state applicability, informative framework mappings, project evidence links, retention-aware state and server-derived deployment gates.
- **Commercial operations:** Stripe Managed Payments, Resend transactional email, reports, subscriptions, public self-service onboarding, metrics, retention, backups and controlled restoration.

## Risk knowledge boundary

The public Risk Library exposes plain-English problems, impacts, high-level controls and informative framework mappings. Exact check methods, required evidence, pass/fail criteria and exports require a verified account. Project Evidence Readiness is derived from authoritative project links; declarations alone do not count as tested controls, generic artefacts do not prove a test passed, and runtime approval for one exact action is not residual-risk acceptance.

ARL-RKA-1.2.0 contains 108 expert-authored candidate entries. Each entry now defines a bounded problem, identities, abuse tests, evidence, pass/fail conditions, containment, remediation, monitoring and retest requirements. Candidate content is not customer-exercised, independently reviewed or verified automation unless a lifecycle record supplies the required reviewer and evidence. Framework mappings are informative and do not establish compliance or certification.

The catalogue API uses `items`, `total`, `limit`, `offset` and `hasMore`; records 101–108 are reachable through pagination. All 66 applicability predicates are classified as user-answerable, derived, system-observed, project-metadata-derived or manual-review-only. Unknown remains review-required. Risk severity is contextual: a null catalogue severity means project context is required, not that risk is low or absent. Priority remains separate from project severity and server-derived deployment decisions.

## Control Intelligence

Authenticated projects can create immutable, server-digested system snapshots and review a bounded evidence chain linking ARL-RKA-1.2.0 controls to canonical tests, executions, classified evidence, existing findings/remediation, runtime decisions, exact-action approvals, retests and exact-snapshot deployment decisions. This is a typed relational model over the existing PostgreSQL/SQLite adapters—not a second graph database. See [Control Intelligence Graph](docs/CONTROL_INTELLIGENCE_GRAPH.md).

Versioned deterministic architecture suggestions help customers prioritize all 108 controls without deciding applicability for them. The guided bulk review records a separate reason, confirmed facts, evaluator identity and immutable revision for every selected control; one stale or invalid item rejects the bounded batch instead of being silently counted as reviewed.

Control Intelligence is proprietary evidence-linked decision support, not an accredited certification or a guarantee that an agent is risk-free.

## Runtime privacy boundary

The hosted Guard API does **not retain raw prompts, model responses or tool arguments**. It stores the decision, matched rule identifiers, digests, bounded metadata, timestamps and policy context needed for audit and remediation. Customers that cannot transmit content to a hosted screening service can run the packaged local gateway instead.

## Production stack

- Render paid Docker web service
- Render Managed PostgreSQL
- Stripe Managed Payments
- Resend transactional email
- GitHub source and deployment
- Namecheap DNS for `agentrisklayer.com`

## Local validation

Node.js 22.5 or later is required.

```bash
npm ci
npm run validate
npm run test:load
```

The automated suite uses an isolated SQLite compatibility adapter only under `NODE_ENV=test`. Production startup fails closed unless a managed PostgreSQL `DATABASE_URL` and every mandatory production setting are present.

## Configuration

Use `.env.example` as a reference only. Configure secrets in Render, never in Git.

Required production controls include:

```text
DATABASE_URL
SESSION_SECRET
BASE_URL
METRICS_TOKEN
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO_REPORT
STRIPE_PRICE_DEVELOPER_MONTHLY
STRIPE_PRICE_TEAM_MONTHLY
STRIPE_PRICE_AGENCY_MONTHLY
RESEND_API_KEY
EMAIL_FROM
ADMIN_EMAIL
SUPPORT_EMAIL
COMPANY_LEGAL_NAME
COMPANY_ADDRESS
LEGAL_JURISDICTION
```

`render.yaml` provisions the paid web service and managed PostgreSQL database and injects the private connection string.

## Guard API

Create a project and issue a one-time key from `/control-plane.html`, then call:

```bash
curl -sS https://agentrisklayer.com/v1/guard \
  -H 'Authorization: Bearer arl_live_...' \
  -H 'Content-Type: application/json' \
  -d '{
    "request_id":"checkout-01",
    "input":"Summarise this support request",
    "tool_call":{"name":"tickets.read","arguments":{"ticket_id":"T-104"}}
  }'
```

Requests are replay-safe by `request_id`. A duplicate returns the original decision without consuming usage twice. See `CONTROL_PLANE_API.md` for the complete contract, status codes and integration guidance.

## Database lifecycle

Migrations run once at startup under a PostgreSQL advisory lock and are recorded with SHA-256 checksums in `schema_migrations`. A modified applied migration is rejected.

```bash
DATABASE_URL='postgresql://...' npm run db:backup
npm run db:verify-backup -- ./data/backups/<archive>.dump
RESTORE_DATABASE_URL='postgresql://...' npm run db:restore -- ./data/backups/<archive>.dump --force
```

Restore only to a separately supplied destination during an approved maintenance window. Render-managed recovery remains the primary infrastructure recovery mechanism; application archives are an independent recovery control.

## Health, readiness and metrics

- `GET /api/health` — process liveness, no database dependency
- `GET /api/ready` — PostgreSQL connectivity and mandatory production configuration
- `GET /api/admin/readiness` — authenticated owner configuration view
- `GET /metrics` — protected Prometheus metrics using `Authorization: Bearer <METRICS_TOKEN>`

## Commercial catalogue

- Community: **free** — 1 project and 10,000 Guard decisions/month
- AI agent security assessment: **£99 once**
- Developer: **£29/month**
- Team: **£99/month**
- Agency: **£249/month**
- Enterprise: **from £6,000/year**

Entitlements are enforced server-side. Stripe displays tax, renewal and cancellation information before payment.

## Deployment

Follow `DEPLOYMENT.md`, `DEPLOYMENT_OWNER_INPUTS.md`, `OPERATIONS_RUNBOOK.md` and `LAUNCH_CHECKLIST.md`. Do not mark the service live until the credential-bound production journey, managed PostgreSQL restore drill, payment webhook, email delivery, metrics and mobile checks pass.

## Evidence boundary

Automated results are internal engineering validation. They are not an independent penetration test, certification, guarantee, insurance product or production history. External testing, legal review and customer evidence remain separate launch controls.
