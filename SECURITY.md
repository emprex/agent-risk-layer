# Security Policy

## Supported release

AgentRiskLayer 4.2 is the supported controlled-beta release.

## Reporting vulnerabilities

Use the private contact published at `/.well-known/security.txt`. Do not send customer secrets, personal data or production exploit evidence through public channels.

## Identity and session controls

- Salted asynchronous scrypt password hashing
- Verified-email gates for purchases and evidence workflows
- Optional TOTP MFA and one-time recovery codes
- Production administrator MFA requirement
- Recent-password/MFA reauthentication for destructive actions
- HTTP-only SameSite session cookies
- Idle and absolute session expiry
- CSRF protection
- Persistent, progressive rate limits
- Trusted right-most proxy-chain client-IP resolution

## Payment and delivery controls

- Stripe webhook signature verification
- Idempotent event tracking
- Durable fulfilment state machine
- Transactional paid-access grant
- Retryable PDF/email jobs with backoff
- Dead-letter alerts and administrator reconciliation
- Shared report snapshot generation across download and email paths

## Evidence and controlled-testing controls

- Separate private-access and public-share tokens
- Object-level ownership checks
- HMAC-hashed one-time evidence tokens
- SHA-256 and Ed25519 evidence integrity
- Official Inspector and Runner build-digest checks
- Atomic token claims and replay rejection
- Secret-like payload rejection
- Written Rules of Engagement
- Assessment, environment and endpoint-origin binding
- Campaign start/completion window enforcement
- Automated evidence retention, deletion receipts and explicit legal holds

## Browser and application controls

- Strict CSP without `unsafe-inline`
- No public inline style attributes
- Frame denial, MIME sniffing prevention and strict transport security
- Request-size limits and malformed-input handling
- Data export and account deletion
- Consistent SQLite backup, checksum verification and atomic restore tooling

## Trust limitations

Integrity verification proves that the submitted bundle matches its local signature and published tool release. It does not prove completeness, independent custody, production equivalence or absence of pre-generation tampering.

## External assurance

Do not describe AgentRiskLayer as independently certified, enterprise audited or guaranteed secure until external penetration testing, independent methodology review, legal review, a live restore drill and real-customer evidence are complete.
