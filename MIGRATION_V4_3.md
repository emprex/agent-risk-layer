# AgentRiskLayer 4.3 controlled-beta migration

Version 4.3 adds a durable superuser role, a 20-seat invitation gate and the
founding-beta commercial prices.

## Required Render settings

Keep `ADMIN_EMAIL` set to the owner's existing account email. On application
startup, that account is migrated to `role=superuser`. Keep MFA enabled.

Add:

```text
BETA_INVITE_LIMIT=20
REQUIRE_BETA_INVITE=true
```

Update the four Stripe prices and then set the corresponding new Price IDs:

```text
STRIPE_PRICE_BASIC_REPORT=       # £19 one-off
STRIPE_PRICE_PRO_REPORT=         # £79 one-off
STRIPE_PRICE_DEVELOPER_MONTHLY=  # £49/month
STRIPE_PRICE_AGENCY_MONTHLY=     # £149/month
```

### Automated Stripe and Render update

The included script creates or safely reuses the four v4.3 Stripe Prices and
updates the four service-level Render environment variables:

```bash
export STRIPE_SECRET_KEY='sk_...'
export RENDER_API_KEY='rnd_...'
export RENDER_SERVICE_ID='srv-...'

# Preview only — no external changes
npm run prices:update

# Create/reuse prices and update Render
npm run prices:update -- --apply

# Also trigger a Render deployment
npm run prices:update -- --apply --deploy
```

Use the Stripe test key first if you want to validate the flow in the Stripe
sandbox. The script does not write credentials to disk or print their values.

Do not delete old Stripe Prices. Archive them after the new deployment is
healthy so historical purchases and subscriptions remain reconcilable.

## Post-deployment checks

1. Sign in as the configured owner and complete MFA.
2. Confirm the dashboard displays `Superuser access active`.
3. Open `/admin.html`, create one email-bound invitation and copy its code.
4. In a private browser, confirm registration without a code is rejected.
5. Register with the code, verify the email and confirm the code cannot be reused.
6. Run one assessment and download its Professional report from the owner account.
