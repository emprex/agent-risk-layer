# AgentRiskLayer security policy

## Reporting a vulnerability

Use the contact published at `/.well-known/security.txt`. Do not include live credentials, raw customer prompts, payment data or unnecessary personal information in the initial report. We will acknowledge, triage and coordinate remediation according to severity and customer impact.

## Security architecture

- Production persistence is managed PostgreSQL through `DATABASE_URL`; startup fails closed without mandatory controls.
- Passwords use asynchronous scrypt; sessions are HTTP-only, SameSite and CSRF protected.
- MFA, email verification, recovery codes, rate limits and trusted-proxy handling protect account access.
- Workspace roles and server-side ownership checks enforce tenant boundaries.
- Project API keys are shown once, stored only as hashes, scoped to a project and immediately revocable.
- `/v1/guard` has malformed-key rejection, authentication-path protection, per-key burst limits, monthly plan quotas and replay-safe request IDs.
- Hosted runtime evidence excludes raw prompts, responses and tool arguments.
- High-impact tools can require approval bound to the exact action and parameters.
- Inventory drift, remediation status and project changes are audit logged.
- Stripe webhook signatures control fulfilment; browser redirects never grant access by themselves.
- Inspection and red-team evidence uses digests/signatures, one-time upload tokens and replay protection.
- Production metrics require a separate strong bearer token.
- PostgreSQL migrations are checksum protected; backups are hashed and verified before restoration.

## Scope and limitations

AgentRiskLayer provides security decision support and enforcement controls. It is not an independent penetration test, certification, guarantee, legal opinion or insurance product. Internal benchmarks cover disclosed synthetic cases and must not be represented as universal detection accuracy.

## Release requirements

No release is production-ready until automated tests, syntax checks, smoke journey, detection benchmark, safety scenarios, load test, manifest verification and owner-controlled live-service checks pass.
