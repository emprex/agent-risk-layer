# AgentRiskLayer — Release notes

## v9.2.0 — Exact-action approval integrity and public evidence proof

Release date: 30 July 2026

## Security control repair

- Replaces caller-controlled `humanApproved`, `productionApproved` and equivalent booleans with server-issued approval tokens.
- Restricts approval issuance and revocation to project administrators and owners.
- Binds every approval to the exact workspace, project, environment, tool and canonical tool arguments.
- Limits approval validity to between 30 seconds and one hour.
- Stores only SHA-256 token digests in the database; the bearer token is displayed once.
- Records authenticated approver identity in the protected ledger and audit trail while omitting the internal user identifier from the bearer token.
- Atomically consumes an approval with the allowed runtime event.
- Rejects changed targets, changed values, expired approvals, revoked approvals and consumed-token replay.
- Uses PostgreSQL row locking for the specific approval record rather than serialising unrelated Guard traffic.
- Records issuance, revocation, consumption and denial evidence without retaining raw tool arguments.

## Public evidence demonstration

- Rebuilds the controlled customer-support-agent demonstration around the full evidence chain:
  Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision.
- Adds a downloadable, SHA-256-integrity-protected proof manifest using fictional data and dry-run actions only.
- Removes unsupported performance language and separates implementation evidence from production verification.
- States explicitly that the proprietary assessment is not an accredited certification or a guarantee that a system is risk-free.

## Data and compatibility

- Adds migration `008_runtime_approval_integrity.sql`; it is additive and does not delete or rewrite existing customer data.
- Adds equivalent local SQLite structures for isolated testing and development.
- Includes approval ledger records in authenticated account exports and applies project retention cleanup.
- Uses a nullable approver reference with `ON DELETE SET NULL` so account deletion remains possible when a shared project is retained; active tokens then fail ledger verification.
- Existing project API keys remain valid. Approval-required actions now fail closed until an authorised user issues an exact-action token.
- Local standalone Runtime Gateway does not share the hosted approval ledger and therefore fails closed for approval-required actions.

## Internal validation

- `npm run validate`: 157/157 tests passed, zero failures and zero skipped tests.
- End-to-end smoke journey exercised server-issued approval, changed-value denial, exact action allow-and-consume, replay denial and account export.
- Focused approval gate: 28/28 tests passed.
- Internal synthetic detection regression: 20/20 cases passed with zero false positives and zero false negatives on the stated dataset.
- Deterministic safety regression: 1,000/1,000 scenarios passed with zero unsafe deployment decisions.

## Verification boundary

- Automated results are internal engineering evidence, not independent certification.
- Production deployment, migration application and the live approval journey must be verified against the exact deployed commit before production effectiveness is claimed.

## v9.0.0 — Hosted security control plane

- Added scoped security projects with server-enforced Community, Developer, Team, Agency and Enterprise entitlements.
- Added one-time hashed project API keys, immediate revocation and billing-owner enforcement across workspaces.
- Added the hosted `POST /v1/guard` API for prompt, output and tool-call policy decisions in monitor or enforce mode.
- Added replay-safe request IDs, monthly quotas, per-key burst limits, authentication-path abuse protection and standard retry guidance.
- Added privacy-safe runtime evidence that excludes raw prompts, model responses and tool arguments.
- Added versioned policies, transaction-bound approval checks and asynchronous signed integration notification for denied actions.
- Added AI asset snapshots, drift comparison and a deployment gate that requires review when privileged exposure changes.
- Added owned remediation work with severity, due date, state, verification evidence and audit history.
- Added a responsive browser control plane, developer quick start, hosted/local runtime choice and transparent plan entitlements.
- Added protected Prometheus metrics, control-plane retention, account export/deletion coverage and production monitoring requirements.
- Added PostgreSQL migration `003_security_control_plane.sql` and complete compatibility coverage for the isolated test adapter.
- Final internal release gate is recorded in `RELEASE_VALIDATION_V9.md`; these results are engineering validation, not independent certification or production history.

## v8.1.0 — PostgreSQL production release candidate

- Replaced production filesystem persistence with pooled PostgreSQL through `DATABASE_URL`.
- Added checksum-recorded, advisory-lock-protected PostgreSQL migrations.
- Converted database callers and critical multi-step flows to asynchronous connection-bound transactions.
- Added database readiness, graceful pool shutdown and structured operational logging.
- Replaced filesystem backup/restore with `pg_dump`/`pg_restore`, SHA-256 manifests and forced controlled restore.
- Updated Render Blueprint to provision paid web hosting and managed PostgreSQL without a disk.
- Added PostgreSQL adapter, migration, infrastructure and backup contract tests.
- Updated commercial pricing to £99 founding assessment, £29 Developer, £99 Team and £249 Agency; Enterprise starts from £6,000/year.
- Preserved internal security, customer, payment, email, invitation, workspace, SCIM, report and evidence journeys.
- Final internal gate: 80/80 tests, complete smoke journey, 20/20 labelled synthetic detection cases, 1,000/1,000 safety scenarios and 5,000/5,000 local load requests.
- Live Render PostgreSQL, Stripe, Resend, DNS and browser verification remain credential-bound deployment checks, not completed production history.

## v5.1.0 — Adaptive and continuous assurance

- Adds deterministic attack mutation across five strategies.
- Adds response-dependent multi-turn escalation with up to three rounds.
- Increases repeated trials to ten per case.
- Records redacted strategy and round evidence without uploading raw transcripts.
- Adds an optional HTTPS completion webhook for portable notifications.
- Adds a weekly scheduled GitHub assurance workflow with SARIF and evidence retention.
- Preserves production refusal, synthetic-data requirements, dry-run tools and Rules of Engagement.
- Extends the server upload allowlist for the signed v5.1 runner.

## v5.0.1 — Safety precedence and stress-test gate

- Forces `DO NOT DEPLOY` whenever the assessment identifies a critical attack path, regardless of the aggregate score.
- Adds a regression test for critical-path decision precedence.
- Adds a deterministic 1,000-scenario functional and security-invariant gate.
- Adds a local concurrent HTTP/session stress harness with latency, throughput, status and error reporting.

## v5.0.0 — Developer-native continuous assurance

- Adds a five-minute local scan and GitHub code-scanning quick start.
- Publishes a ready-to-copy GitHub Action with checksum verification, SARIF upload and a configurable security gate.
- Adds Inspector baseline comparison for new, resolved and unchanged findings plus posture movement.
- Adds transparent OWASP, NIST AI RMF, SLSA and NIST SSDF mapping without claiming certification.
- Promotes developer onboarding and release-to-release assurance on the homepage.
- Preserves the v4.5 interactive demo, controlled red-team workflow, payment fulfilment and superuser beta operations.

## v4.5.0 — Interactive proof and clearer conversion journey

- Adds a no-login, synthetic-data interactive demo showing the full declared → observed → reproduced → retested evidence flow.
- Repositions the homepage around the direct outcome: find dangerous permissions and attack paths before deployment.
- Reduces the core workflow to four clear actions: scan, reproduce, fix and verify.
- Makes the downloadable sample Professional PDF visible from the homepage, demo and pricing page.
- Clarifies what happens after each pricing action and distinguishes one-off assessment purchases from recurring plans.
- Adds the demo page to the public sitemap.
- Preserves the corrected Stripe price lookup and creation parameters used for the live v4.4.0 price migration.

## v4.4.0 — Searchable Help Centre and user manual

- Adds a public, responsive `/help.html` Help Centre accessible from the main
  navigation and contextually from product workflows.
- Adds plain-English onboarding, a six-step process guide, assessment manual,
  report interpretation, Inspector and Red Team instructions, remediation and
  retest guidance, current plan definitions, troubleshooting and limitations.
- Adds a searchable AI-agent security glossary covering prompt injection, tool
  poisoning, memory poisoning, excessive agency, exfiltration, evidence,
  severity, residual risk, Rules of Engagement, synthetic data and dry-run tools.
- Keeps declared, observed, reproduced and retested evidence explicitly separate
  and warns users that scores are not breach probabilities or certification.
- Adds the Help Centre to the public sitemap and smoke-test coverage.

Release date: 22 July 2026

## Product completion

- Complete assessment-to-report customer journey.
- Free risk summary with a protected professional-report paywall.
- One-off Essential and Professional purchases.
- Developer and Agency subscriptions.
- Generated PDF reports and transactional email fulfilment.
- Customer dashboard, payment history and owner analytics.
- Private-by-default public summary links and embeddable badges.

## Security and privacy hardening

- Separate cryptographically random private-access and public-share tokens.
- Regression protection proving public links cannot expose private results or paid PDFs.
- CSRF protection on state-changing browser requests.
- Strict session cookies, session invalidation and per-user session limits.
- Salted scrypt password hashing and one-use password reset tokens.
- Security headers, request-body limits and route-specific rate limits.
- Stripe webhook signature verification and event idempotency.
- Production startup fails closed when required security, billing, email or legal configuration is missing.
- Account data export, assessment deletion and permanent account deletion.

## Reporting and governance

- Versioned scoring model (`arl-risk-v1.1`).
- Full response appendix, prioritised remediation plan and limitations in paid reports.
- OWASP AI-agent security and NIST AI-risk-management references included as methodological context.
- Explicit acceptance of versioned terms during registration.
- Configurable operator identity, support address and legal jurisdiction.

## Deployment and operations

- Zero external npm runtime dependencies.
- Node 22 built-in SQLite persistence.
- Non-root Docker image and health check.
- Render deployment blueprint with persistent storage.
- Owner launch-readiness dashboard.
- Launch checklist, security policy and environment template.

## Validation result

`npm run validate` passed on 22 July 2026:

- 6/6 unit and production-configuration tests.
- Syntax validation for the server, source modules and browser scripts.
- End-to-end smoke test covering registration, assessment, private/public token isolation, paid fulfilment, PDF generation, subscription activation, account export, password recovery, password change and account deletion.

Live Stripe, Resend, tax, legal, monitoring and independent security validation require production credentials or external professional review and are therefore launch-operator tasks rather than bundled code.

## v1.1.1 — Stripe Managed Payments compatibility

- Enables `managed_payments[enabled]=true` on every Stripe Checkout Session.
- Pins Stripe API requests to `2025-03-31.basil`, the minimum Managed Payments-compatible API version.
- Adds Render and `.env.example` configuration for `STRIPE_API_VERSION`.
- Adds regression tests protecting the Managed Payments integration.



## v1.1.2 — Current Managed Payments preview API

- Updates Stripe API requests to `2026-03-04.preview`, matching Stripe's current Managed Payments setup documentation.
- Updates Render, local environment examples, smoke validation, and regression tests.

## v1.1.3 — Stripe Dahlia webhook compatibility

- Uses Stripe API version `2026-06-24.dahlia`.
- Supports subscription billing periods from `items.data[].current_period_end`.
- Supports failed-invoice subscription references from `invoice.parent.subscription_details.subscription`.
- Retains backward compatibility with older Stripe webhook payload shapes.
- Adds regression tests for the current webhook object structure.

## v2.0.0 — Evidence-led Agent Security Review

- Expands the assessment to 25 security controls across exposure, authority, data, tools, memory, monitoring, governance and incident response.
- Adds evidence confidence for every answer: none, claimed, documented or tested.
- Separates inherent exposure, control weakness and evidence confidence.
- Adds credible multi-control attack paths rather than isolated checklist findings.
- Adds detailed finding impact, required control, evidence status and framework mappings.
- Rebuilds the Professional PDF as an 11-section decision and assurance report.
- Adds remediation owners, deadlines, verification methods and retest acceptance criteria.
- Adds a transparent methodology page and Professional report preview.
- Updates the results page with deployment decision, risk composition and attack-path visibility.


## v3.0.0 — AgentRisk Inspector and continuous technical evidence

### Product

- Adds an official, downloadable, zero-dependency local inspector.
- Adds a private inspector workspace for creating one-time upload commands and viewing scan history.
- Separates self-declared risk from observed technical risk.
- Adds observed findings to paid reports without claiming independent verification.
- Adds scan-to-scan change tracking for new, resolved and unchanged findings.
- Adds professional PDF sections for local technical evidence, integrity, scope and drift.

### Scanner

- 27 deterministic policy checks covering secrets, supply chain, CI/CD, containers, Kubernetes, MCP/tool scope, AI execution, output validation, approvals, memory, resource limits, governance and tests.
- No target-code execution, exploitation, symlink following or network probing.
- Source code and matched secret values excluded from bundles.
- Optional relative paths; default evidence uses basenames and path hashes.
- Ed25519 signature and SHA-256 digest.
- Published scanner-release digest comparison with explicit remote-attestation limitation.
- SARIF export and `--fail-on` CI release gates.
- Optional stable local signing key.
- Disclosed exclusions and accountable accepted-risk review configuration.

### Platform security

- One-time inspection tokens stored as HMAC hashes.
- Fifteen-minute token expiry and single-use transaction.
- Unique bundle digest replay protection.
- 2 MB upload limit and bounded schema validation.
- Bundle freshness checks and secret-like payload rejection.
- Inspection access limited to assessment owners.
- Account export and deletion include inspection evidence.

### Validation

- Adds redaction, secret-value exclusion, signature-tamper, approved-release, replay-protection and drift-comparison tests.
- Full commercial flow remains covered: account, assessment, paywall, PDF, subscription, sharing, recovery, export and deletion.
- Recalculates inspection posture and finding totals server-side instead of trusting submitted summaries.
- Claims one-time scan tokens atomically to prevent concurrent reuse.
- Uses non-correlating per-scan HMAC fingerprints for detected credential values.
- Adds a public Trust Centre, dynamic security.txt and downloadable 20-page sample report.
- Adds a private, bookmarkable technical-evidence detail page.

## v4.1.0 - Controlled beta hardening

### Reliability

- Invalid JSON now returns HTTP 400 rather than an unexpected HTTP 500.
- Account data exports now include red-team authorisations.
- Added SQLite backup creation, SHA-256 manifests, independent verification and restore-drill tooling.

### Static Inspector precision

- Added named false-positive review with owner, reason and expiry.
- False-positive findings remain visible but are excluded from technical-risk scoring.
- Secret-shaped values in test/example contexts are downgraded pending review.
- Public image/SVG wildcard CORS is no longer reported when the response is explicitly public, cacheable and cross-origin safe.

### Controlled testing

- Expanded from 16 to 32 attack cases.
- Added 1-5 repeated trials, pass rate and confidence statements.
- Added encoded, multilingual, hidden-markup, RAG poisoning, SSRF-shaped, SQL-shaped, command-shaped, template-shaped, tenant-isolation, stale-approval, tool-shadowing and recursive-delegation cases.
- Added written Rules of Engagement with authority, scope, window, emergency contact, expiry and revocation.
- Staging uploads are bound to the approved assessment, campaign mode, environment and endpoint origin.

### Reporting and website

- Redesigned the Professional PDF with a premium cover, metric cards, risk bars, decision callouts and Rules of Engagement evidence.
- Updated the website with controlled-beta disclosure, evidence ladder, repeated-trial messaging and clearer assurance boundaries.
- Updated founding-beta pricing language without changing Stripe prices.

## v4.2.0 — Reliability, identity and operational hardening

### Payment reliability

- Introduces durable purchase fulfilment states and retryable background jobs.
- Grants paid access transactionally before asynchronous PDF/email work.
- Records Stripe session snapshots and report-snapshot digests.
- Adds exponential retry, dead-letter handling, operational alerts and admin reconciliation.
- Makes webhook and checkout-status processing safe to repeat after partial failure.

### Report consistency

- Uses one report service for browser downloads, email delivery and retries.
- Includes the latest Inspector and Red Team evidence in every Professional report snapshot.
- Records report integrity metadata used for operational verification.

### Identity and abuse resistance

- Replaces synchronous password hashing with asynchronous scrypt.
- Adds email verification and gates paid/evidence-producing actions behind it.
- Adds TOTP MFA, recovery codes and MFA login challenges.
- Adds reauthentication for destructive account actions.
- Adds idle and absolute session expiration.
- Adds persistent SQLite-backed rate limits and trusted-proxy client-IP resolution.
- Requires MFA for production administrator access.

### Privacy and testing authority

- Enforces Rules of Engagement campaign start/completion windows.
- Adds scheduled evidence retention enforcement, deletion receipts and legal holds.
- Exposes retention status and fulfilment status in customer and operator views.

### Operations and platform

- Adds alerts and reconciliation controls to the owner dashboard.
- Adds checksum-verified atomic database restore tooling and backup rotation.
- Pins the production Node container tag.
- Removes inline styles and `unsafe-inline` from the browser CSP.
- Removes unsupported Agency client/team-workspace claims.
# v5.2.0 — Runtime enforcement

- Added a customer-operated HTTP runtime gateway.
- Added tool allowlists/denylists, path boundaries and host allowlists.
- Added secret-like argument blocking and explicit human/production approvals.
- Added enforce and monitor modes with fail-closed evaluation.
- Added privacy-preserving JSONL runtime evidence.
- Added downloadable gateway, example policy and runtime product page.
- Preserved Inspector, adaptive red-team, payment, invitation and account flows.
# v6.0.0 — Full-lifecycle security experience

- Rebuilt the public product experience around one clear journey: inspect, attack-test, enforce and prove.
- Added a responsive security command-centre preview and a clearer conversion path.
- Added decoding-aware and context-composed runtime detection.
- Added signed SSO state, SCIM user lifecycle normalisation, signed webhooks, and Slack/Jira-ready event builders.
- Preserved existing payments, invitations, MFA, assessments, Inspector, adaptive red-team, runtime gateway, reports and release gates.
