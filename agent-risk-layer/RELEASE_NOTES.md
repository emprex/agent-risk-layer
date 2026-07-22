# AgentRiskLayer v1.1.0 — Launch-ready beta

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
