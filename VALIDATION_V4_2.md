# AgentRiskLayer 4.2 Release Validation

Validation was performed against the release worktree and repeated after clean archive extraction. This is internal release evidence, not an independent penetration-test certificate.

## Release-gate result

**Internal engineering release gate: PASS for invitation-only controlled beta.**

All six blockers from the v4.1 audit were fixed and regression-tested. One additional public-read rate-limit issue found during v4.2 load testing was also fixed and retested.

## Automated validation

- Full unit/integration suite: **39/39 passed**
- JavaScript syntax validation: passed
- Complete commercial smoke flow: passed
- Production fail-closed configuration test: passed
- Malformed JSON: HTTP 400
- Missing CSRF: HTTP 403
- Private/public token isolation: passed
- Account export and deletion: passed

## Payment and report-delivery simulation

- Paid access granted transactionally after confirmed Checkout payment.
- PDF/email work persisted as a retryable fulfilment job.
- Simulated provider failure moved the job into retry state without removing paid access.
- Reprocessing completed the job and updated customer-visible delivery status.
- Report snapshot digest matched the exact stored JSON.
- Existing Red Team evidence was present in the emailed/downloaded report snapshot.
- Duplicate/retried fulfilment remained idempotent.
- Owner reconciliation and operational-alert paths were exercised.

## Identity and abuse-resistance tests

- Asynchronous scrypt allowed event-loop progress under concurrent password verification.
- Email verification gates protected payment and evidence workflows.
- TOTP MFA enrolment and protected login passed.
- Recovery-code storage uses hashes rather than plaintext codes.
- Public user JSON did not expose internal session token hashes.
- Right-most trusted proxy resolution resisted left-most `X-Forwarded-For` spoofing.
- Rate-limit state persisted in SQLite.
- Public, health and API traffic use separate bounded buckets.

## Authorisation, privacy and retention

- Staging evidence outside the approved Rules of Engagement window was rejected.
- Expired Red Team evidence was deleted automatically.
- A deletion receipt was retained without raw evidence.
- Legal hold prevented deletion.
- One-time token replay and concurrent-claim protection passed.
- Uploaded Inspector and Red Team bundles excluded raw prompts, raw responses and secret canaries.

## Adversarial simulations

### Hardened target

- Cases: 32
- Repeated trials: **160/160 passed**
- Pass rate: 100%
- Risk score: 0/100
- Assurance score: 100/100
- Grade: A
- Decision: CONTROLLED TESTS PASSED

### Deliberately vulnerable target

- Repeated trials: 160
- Unsafe outcomes reproduced: **155/160**
- Critical failures: 55
- High failures: 90
- Medium failures: 10
- Risk score: 100/100
- Assurance score: 0/100
- Grade: F
- Decision: DO NOT DEPLOY

## Static Inspector

The release scanned itself with the customer-side Inspector:

- Posture: 100/100
- Technical risk: 0/100
- Grade: A
- Active material findings: 0
- One low test-fixture secret-shaped observation remained visible as a reviewed/suppressed false positive.

## Risk-engine simulation

- Randomised valid assessments: **20,000**
- Exceptions or invariant failures: **0**
- Score bounds: all scores remained between 0 and 100
- Determinism: repeated evaluation of identical answers produced identical scores
- Every material finding retained severity, impact and remediation guidance

## Load and concurrency

Fresh local production-equivalent application process:

- Health endpoint: **600/600 HTTP 200**
- Homepage: **300/300 HTTP 200**
- Concurrent Professional PDFs: **25/25 HTTP 200**
- PDF bytes returned: 2,377,025 total
- Malformed JSON under authenticated flow: HTTP 400
- State-changing request without CSRF: HTTP 403

These are bounded single-instance beta tests, not a capacity guarantee.

## Website and accessibility static review

- HTML pages checked: 21
- Internal links checked: 101
- Broken internal links: 0
- Duplicate IDs: 0
- Unlabelled form controls: 0
- Images missing alt attributes: 0
- Inline style attributes: 0
- CSP contains no `unsafe-inline`
- Production headers include HSTS, frame denial, MIME-sniffing prevention and Origin-Agent-Cluster

## Professional PDF review

- Pages: 17
- Section bookmarks: 13
- Metadata: title, author, subject, creator and producer present
- Visual render: all pages rendered successfully at 160 DPI
- Clipped text, overlaps or broken glyphs observed: none
- Pagination was condensed from 22 pages to 17 to remove orphaned/mostly empty continuation pages
- Limitation: PDF/UA tagging and independent screen-reader verification remain future external accessibility work

## Backup and restore

- Consistent SQLite backup: passed
- Manifest SHA-256 verification: passed
- Independent read-only `quick_check`: passed
- Atomic restore to a new path: passed
- Tampered backup rejection: passed

## Residual external assurance work

The release must not be described as independently certified or objectively perfect. The following require parties or evidence outside this build process:

- Independent penetration test of the deployed service and downloadable tools
- External AI/AppSec precision and recall benchmarking
- Legal review of Rules of Engagement, privacy, terms, refunds and consumer rights
- Live Render backup/restore exercise under an approved maintenance window
- WCAG 2.2 AA assistive-technology audit
- Real-customer false-positive, remediation and retention outcome evidence
- PostgreSQL/shared operational state before horizontal scaling

## Decision

AgentRiskLayer 4.2 is suitable for an **invitation-only controlled beta** after a verified live database backup and administrator MFA enrolment. Broader enterprise or independent-assurance claims remain blocked by the external work above.
