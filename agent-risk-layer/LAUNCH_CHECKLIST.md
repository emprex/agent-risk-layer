# AgentRiskLayer Launch Checklist

## Required before test customers

- [ ] Choose the production domain.
- [ ] Configure the registered operator name, address, jurisdiction and support email.
- [ ] Obtain legal review of the generated Terms and Privacy Notice.
- [ ] Create Stripe test products and all four Price IDs.
- [ ] Configure and verify the Stripe webhook.
- [ ] Verify a Resend sending domain.
- [ ] Deploy with a persistent disk.
- [ ] Run `npm run validate` locally.
- [ ] Confirm the admin readiness screen reports no required failures.
- [ ] Complete registration, password reset, purchase, subscription, cancellation, export and deletion tests on production infrastructure using test payments.

## Required before live payments

- [ ] Add live Stripe keys only after test-mode approval.
- [ ] Configure VAT/tax and legal invoice identity.
- [ ] Publish refund and support procedures approved for the chosen jurisdiction.
- [ ] Enable uptime, error and backup monitoring.
- [ ] Perform and document a database restore test.
- [ ] Complete independent penetration testing.
- [ ] Review the scoring methodology with a qualified AI-security practitioner.
- [ ] Confirm accessibility and mobile-browser testing.
- [ ] Create a support escalation and incident-response process.

## Controlled beta targets

- [ ] Recruit 10–20 target users.
- [ ] Measure assessment completion rate.
- [ ] Measure free-to-paid conversion.
- [ ] Record report usefulness and false-positive feedback.
- [ ] Review every support request and failed email/payment event.
- [ ] Update scoring and report language using a new scoring-version identifier.
