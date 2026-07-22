# AgentRiskLayer

A complete, zero-dependency Node 22 application for selling automated AI-agent security assessments.

## Customer journey

1. Complete a twelve-domain security questionnaire.
2. Receive a free 0–100 residual-risk score and the top three findings.
3. Create an account and save the assessment.
4. Buy an Essential report for **£9.99** or a Professional report for **£24.99**.
5. Receive an automatically generated PDF by download and email.
6. Subscribe to Developer for **£19/month** or Agency for **£59/month**.
7. Manage billing, saved assessments, public result links and shareable badges.

## Included

- Responsive landing, assessment, result, pricing, authentication and dashboard screens
- Five focused SEO assessment pages
- Deterministic and tested scoring engine
- Salted `scrypt` password hashing and HTTP-only sessions
- SQLite persistence using Node's built-in `node:sqlite`
- A real free-summary paywall
- Stripe Checkout, verified webhooks, subscriptions and billing portal
- Safe simulated checkout for local testing
- Automatic Essential and Professional PDF generation
- Resend email delivery with PDF attachments
- Owner revenue and funnel analytics
- Public result pages and SVG badges
- Security headers, request limits and rate limiting
- Privacy and terms templates
- Dockerfile and Render blueprint
- Automated tests and end-to-end smoke-test script

## Run locally

Node **22.5 or newer** is required. There are no external npm dependencies.

```bash
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

`DEMO_MODE=true` is the default. Demo checkout charges nothing, records the purchase, generates the report and simulates email delivery unless a Resend key is configured.

```bash
npm run dev
npm test
npm run check
```

## Live Stripe configuration

Create four Stripe Prices and add their IDs to `.env`:

```dotenv
DEMO_MODE=false
STRIPE_SECRET_KEY=sk_...
STRIPE_API_VERSION=2026-03-04.preview
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
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

The application verifies webhook signatures and records each checkout session only once before fulfilment.

Managed Payments is enabled on every Checkout Session, so Stripe/Link acts as merchant of record for eligible products when the feature is activated in the Stripe Dashboard.

## Resend email configuration

```dotenv
RESEND_API_KEY=re_...
EMAIL_FROM=AgentRiskLayer <reports@your-domain.example>
```

Without a key, delivery is logged as simulated and reports remain downloadable.

## Owner analytics

```dotenv
ADMIN_EMAIL=owner@your-domain.example
```

Sign in with that email and open `/admin.html`.

## Database and deployment

Default database:

```text
./data/agent-risk-layer.sqlite
```

Production persistent disk:

```dotenv
DATABASE_PATH=/var/data/agent-risk-layer.sqlite
```

The included `render.yaml` provisions persistent storage. For horizontal scaling or a serverless platform, replace the SQLite adapter with managed PostgreSQL.

## Main routes

```text
/                         Landing page
/assessment.html          Questionnaire
/result.html              Private result and report purchase
/shared.html              Public summary
/pricing.html             Reports and subscriptions
/auth.html                Sign in and registration
/dashboard.html           Customer workspace
/admin.html               Owner analytics
/privacy.html             Privacy template
/terms.html               Terms template
/checks/...                SEO pages
/api/health               Health check
```

## Before public launch

- Replace legal/operator placeholders.
- Obtain legal review for privacy, refunds, consumer rights and liability.
- Configure VAT/tax and invoice details in Stripe.
- Add account deletion and data export.
- Enable monitoring, backups and incident alerting.
- Run penetration testing.
- Test every Stripe flow in test mode before using live keys.

AgentRiskLayer is automated decision support, not a penetration test, certification, guarantee, insurance product or legal opinion.
