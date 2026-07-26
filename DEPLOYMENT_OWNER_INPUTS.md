# Deployment owner inputs

The code package is complete. Only owner-controlled credentials, billing and legal decisions remain.

## Render

- Enable paid Render billing.
- Connect the production GitHub repository and deploy `render.yaml` as a Blueprint.
- Record the web service ID (`srv-...`) for the price-update script.
- Confirm the generated managed PostgreSQL database, private `DATABASE_URL`, 25 GB initial storage and storage autoscaling. The controlled-beta Blueprint uses `basic-1gb`; moving to multiple web instances or PostgreSQL high availability is an owner-controlled cost decision after live load evidence.

## Company and support

Set the final legal entity name, trading/registered address, support email, admin email and legal jurisdiction. The production readiness gate rejects placeholders.

## Stripe Managed Payments

Provide the live Stripe secret/restricted key and webhook signing secret. Run:

```bash
STRIPE_SECRET_KEY='...' \
RENDER_API_KEY='...' \
RENDER_SERVICE_ID='srv-...' \
npm run prices:update -- --apply --deploy
```

This creates or reuses the four versioned GBP prices and writes their IDs into Render. Verify the live webhook URL and all Checkout/billing flows before inviting customers.

## Resend and domain

Provide the live Resend API key and a sender on the already verified AgentRiskLayer domain. Confirm Namecheap DNS, TLS and the production `BASE_URL`. Configure the generated `METRICS_TOKEN` in the selected monitoring service and create availability/error alerts.

## Existing data decision

This release creates the PostgreSQL schema for a clean controlled-beta deployment. If any existing SQLite database contains real customer or payment records that must be preserved, approve a separately tested migration and reconciliation window before cutover. Do not copy the SQLite file into production.
