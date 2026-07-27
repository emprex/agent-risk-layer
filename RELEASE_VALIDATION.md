# AgentRiskLayer v9.1.0 — Release validation

**Decision:** deployment-ready for owner-controlled production rollout. Live v9.1 verification is still required after deployment.

This record describes internal engineering validation. It is not an independent penetration test, certification, compliance attestation or customer case study.

## Implemented customer experience

- Public self-service account creation with no invitation field.
- Email verification, scrypt password hashing, secure sessions, CSRF protection with automatic token recovery, rate limiting and optional MFA.
- Professional desktop and mobile authentication layout.
- Guided first-use dashboard route, 90-second product demonstration, Company page and live Status page.
- Public pages contain no controlled-beta or invitation-only language and no internal version badge.
- Public readiness output is sanitised so database name, user and server version are not exposed.

## Executed release gate

| Gate | Result |
|---|---:|
| Automated tests | **89/89 passed** |
| JavaScript syntax checks | **Passed** |
| Complete customer, payment and security smoke journey | **Passed** |
| Limited labelled detection benchmark | **20/20 passed** |
| False positives / false negatives | **0 / 0** on that limited synthetic dataset |
| Deterministic safety scenarios | **1,000/1,000 passed** |
| Unsafe scenario decisions | **0** |
| Controlled red-team simulation | **32/32 passed** |
| Static self-inspection | **100/100, grade A, 0 active findings** |
| Local mixed-traffic load | **5,000/5,000 requests, 0 errors** |
| Throughput | **3,388.4 requests/second** |
| p50 / p95 / p99 latency | **25.8 / 44.1 / 102.2 ms** |

The self-inspection retains one named, expiring false-positive review for an intentionally invalid credential-shaped test fixture. Static inspection does not prove runtime, cloud or production security.

## Production design

- Render Docker web service.
- Render Managed PostgreSQL 18 in Oregon.
- No production SQLite database and no persistent application disk.
- Stripe Managed Payments and server-enforced plan entitlements.
- Resend transactional email.
- Fail-closed production configuration and protected metrics.

## Required after deployment

1. Confirm `/api/ready` reports `9.1.0`, `production` and a healthy PostgreSQL adapter.
2. Create and verify a real public account on `agentrisklayer.com`.
3. Complete live Stripe checkout, webhook, entitlement, billing-portal and cancellation tests.
4. Confirm Resend verification, password-reset and report-delivery messages.
5. Restore a PostgreSQL backup into a separate non-production database.
6. Complete independent penetration testing and gather genuine customer evidence.
