# AgentRiskLayer 1.1

AgentRiskLayer is a launch-ready beta for selling automated AI-agent security assessments. It runs on Node.js with no third-party npm packages and uses the built-in `node:sqlite` database.

## Customer journey

1. Complete a twelve-domain AI-agent security questionnaire.
2. Receive a free 0–100 residual-risk score and the three highest-risk findings.
3. Create an account and save the assessment.
4. Purchase an Essential report for **£9.99** or Professional report for **£24.99**.
5. Download and receive the generated PDF by email.
6. Subscribe to Developer for **£19/month** or Agency for **£59/month**.
7. Retest systems, manage billing and explicitly enable public summaries or badges.

## Release 1.1 capabilities

### Product

- Responsive landing page, assessment wizard, result screen, pricing and dashboard
- Five search-focused assessment landing pages
- Explainable deterministic scoring with a recorded scoring-model version
- Free-summary paywall that does not expose paid recommendations
- Essential and Professional PDF reports
- Complete response evidence, findings, recommendations, action plan and limitations
- Private-by-default result sharing and SVG badges
- Saved assessment history and deletion
- One-off purchases and monthly subscriptions
- Owner revenue, funnel, risk-band and email-failure analytics

### Accounts and privacy

- Salted `scrypt` password hashing
- HTTP-only, SameSite session cookies
- CSRF protection on every state-changing browser endpoint
- Time-limited, single-use password-reset links
- Password changes invalidate other sessions
- Explicit Terms and Privacy consent record
- Downloadable JSON account-data export
- Permanent account deletion after subscription cancellation
- Dynamic legal/operator details from environment variables

### Payments and delivery

- Stripe-hosted Checkout for one-off and subscription purchases
- Verified Stripe webhook signatures
- Webhook event deduplication and idempotent fulfilment
- Stripe customer billing portal
- Actual Checkout total and currency stored after promotions
- Resend transactional email with PDF attachments
- Safe simulated checkout and email delivery for local testing

### Operations

- Production configuration gate: unsafe production settings stop startup
- Admin launch-readiness screen
- SQLite WAL mode and persistent-disk deployment configuration
- Security headers, HSTS in production, body limits and per-IP rate limiting
- Dynamic `robots.txt`, `sitemap.xml` and `security.txt`
- Docker health check and Render deployment blueprint
- Automated unit, syntax and end-to-end smoke tests

## Run locally

Node **22.5 or newer** is required.

```bash
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

Local mode defaults to `DEMO_MODE=true`. Demo checkout charges nothing but exercises purchase recording, report generation, email logging and subscription access.

```bash
npm run dev
npm test
npm run check
npm run smoke
npm run validate
```

## Production configuration

The server refuses to start with `NODE_ENV=production` until required launch settings pass.

```dotenv
NODE_ENV=production
BASE_URL=https://your-domain.example
SESSION_SECRET=<at-least-32-random-characters>
DEMO_MODE=false
DATABASE_PATH=/var/data/agent-risk-layer.sqlite

COMPANY_NAME=AgentRiskLayer
COMPANY_LEGAL_NAME=<registered operator>
COMPANY_ADDRESS=<business address>
LEGAL_JURISDICTION=England and Wales
SUPPORT_EMAIL=support@your-domain.example
ADMIN_EMAIL=owner@your-domain.example
```

Generate a strong secret, for example:

```bash
openssl rand -base64 48
```

## Stripe

Create four Stripe Prices and configure:

```dotenv
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC_REPORT=price_...
STRIPE_PRICE_PRO_REPORT=price_...
STRIPE_PRICE_DEVELOPER_MONTHLY=price_...
STRIPE_PRICE_AGENCY_MONTHLY=price_...
```

Webhook endpoint:

```text
https://your-domain.example/api/stripe/webhook
```

Subscribe to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

Run every purchase path in Stripe test mode before adding live keys.

## Transactional email

Verify the sending domain in Resend and configure:

```dotenv
RESEND_API_KEY=re_...
EMAIL_FROM=AgentRiskLayer <reports@your-domain.example>
```

Without a Resend key in development, delivery is logged as simulated. Production readiness requires real email settings.

## Owner analytics

Set `ADMIN_EMAIL`, sign in with that account, then open:

```text
/admin.html
```

The page includes commercial metrics, product funnel, risk distribution, failed email delivery and launch-readiness checks.

## Data and backups

Default development database:

```text
./data/agent-risk-layer.sqlite
```

Production persistent disk:

```dotenv
DATABASE_PATH=/var/data/agent-risk-layer.sqlite
```

Back up the SQLite database and its WAL files using a filesystem snapshot or SQLite-aware backup process. Do not copy a live database file without considering active WAL writes.

SQLite is appropriate for a single-instance launch. Move to managed PostgreSQL before horizontal scaling or multi-region deployment.

## Main routes

```text
/                         Landing page
/assessment.html          Questionnaire
/result.html              Private result and report purchase
/shared.html              Explicitly enabled public summary
/pricing.html             Reports and subscriptions
/auth.html                Sign in and registration
/reset.html               Password recovery
/dashboard.html           Customer workspace and account controls
/admin.html               Owner analytics and readiness
/privacy.html             Dynamic privacy notice
/terms.html               Dynamic terms
/checks/...                SEO landing pages
/api/health               Health check
/api/csrf                 Browser security token
/.well-known/security.txt Security contact
```

## Security model

- Card data never enters the application; Stripe hosts checkout.
- Paid fulfilment requires a verified webhook or server-side Stripe session retrieval.
- Free endpoints return only the limited summary.
- Public summaries and badges are disabled by default.
- Password-reset tokens are HMAC-hashed in storage, expire after 30 minutes and work once.
- Session tokens are stored only as HMAC hashes.
- Account deletion is blocked while a subscription is active to prevent orphaned billing.
- Production startup fails closed when critical secrets, HTTPS, billing, email or legal identity are missing.

See [SECURITY.md](SECURITY.md) for reporting and operational guidance.

## What remains external to the code

A technically finished beta is not the same as a legally and commercially approved launch. Before taking live payments:

- obtain jurisdiction-specific legal review of Terms, Privacy, refunds, liability and tax;
- configure Stripe tax/VAT, invoice identity and customer-support processes;
- verify the sender domain and monitor delivery reputation;
- enable encrypted backups, uptime/error monitoring and incident alerting;
- conduct an independent penetration test;
- have a qualified AI-security practitioner review the scoring methodology and report claims;
- run a controlled beta with real users and record conversion, support and false-positive feedback.

AgentRiskLayer is automated decision support. It is not a penetration test, certification, guarantee, insurance product or legal opinion.
