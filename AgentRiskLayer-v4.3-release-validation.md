# AgentRiskLayer 4.3 release validation

## Decision

**PASS — ready for an invitation-only controlled beta after the documented
Render and Stripe configuration update.**

Version 4.3 closes the remaining product-access gap by adding:

- a persistent `superuser` role for the configured owner account;
- Professional report access and unlimited controlled testing for that owner;
- a 20-seat, one-time invitation system with optional email binding, expiry,
  revocation and hashed-at-rest codes;
- an owner invitation-management screen;
- commercially revised founding-beta pricing.

The superuser is not a public bypass. It is assigned only to `ADMIN_EMAIL`,
requires a verified account, and production administration still requires MFA.

## Verified results

| Area | Result |
| --- | --- |
| Automated tests | 41/41 passed |
| Syntax/static checks | Passed |
| Complete commercial smoke flow | Passed |
| Owner superuser entitlement | Passed |
| Invite create/list/revoke | Passed |
| Email-bound, single-use invitation | Passed |
| Randomised risk simulations | 20,000/20,000 passed |
| Hardened and vulnerable Red Team profiles | Passed |
| Health load | 600/600 |
| Homepage load | 300/300 |
| PDF generation and download | Passed, 176,825-byte smoke report |
| Inspector signing, replay and drift | Passed |
| Red Team RoE, replay and retest comparison | Passed |
| Backup, verify and tamper rejection | Passed |
| CSP and inline-style test | Passed |
| Duplicate static HTML IDs | 0 |

## Commercial prices to configure in Stripe

| Product | New price | Billing |
| --- | ---: | --- |
| Essential report | £19 | One-off |
| Professional report | £79 | One-off |
| Developer | £49/month | Recurring |
| Agency | £149/month | Recurring |

Create four new Stripe Prices and update the matching `STRIPE_PRICE_*`
environment variables. Keep the previous Stripe prices for historical records,
then archive them after the new deployment is healthy.

## Readiness scores

These scores assess this package for the defined controlled-beta scope, not a
claim that any security product is universally perfect.

| Angle | Score /10 | Evidence |
| --- | ---: | --- |
| Core product functionality | 9.6 | Full assessment, report, Inspector, Red Team, billing and dashboard smoke journey passed |
| Authentication and account security | 9.5 | Async scrypt, verification, MFA, recovery, session expiry and reauthentication tested |
| Superuser safety | 9.4 | Durable role, owner-only assignment, Professional entitlement and production MFA gate |
| Beta access control | 9.5 | 20-seat capacity, hashed single-use codes, email binding, expiry and revocation |
| Payments and fulfilment | 9.4 | Transactional access, retries, reconciliation and delivery evidence tested |
| Risk engine | 9.5 | Boundary tests plus 20,000 randomised simulations |
| Inspector evidence | 9.6 | Signed/redacted bundle, release digest, replay protection and drift comparison |
| Red Team safety | 9.7 | Production refusal, written RoE, bounded windows, replay protection and hardened/vulnerable profiles |
| Privacy and retention | 9.3 | Data export/deletion, timed purge, legal hold and deletion receipt tests |
| Reliability and operations | 9.4 | Backup/restore, reconciliation, health and homepage load tests |
| Front-end accessibility/security | 9.1 | Labels, duplicate IDs, CSP and inline-style checks; independent assistive-technology audit remains external |
| Commercial beta readiness | 9.4 | Invitation operations, revised prices, owner controls and end-to-end smoke flow |

**Overall controlled-beta score: 9.5/10.**

External penetration testing, legal review, real-customer detector benchmarking
and independent accessibility testing remain external assurance work. They are
not internal software blockers, but they remain necessary before describing the
service as independently validated or moving beyond controlled beta.
