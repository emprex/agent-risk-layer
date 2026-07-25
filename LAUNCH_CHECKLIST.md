# AgentRiskLayer v3 Launch Checklist

## Product integrity before customer scans

- [ ] Run `npm run validate` from a clean checkout.
- [ ] Confirm `/downloads/agent-risk-inspector.mjs`, `.sha256`, release manifest and policy catalogue were generated together.
- [ ] Verify the published scanner checksum from a second machine.
- [ ] Run the Inspector against Node.js, Python, Docker, Kubernetes, GitHub Actions and MCP fixtures.
- [ ] Confirm raw source, secret values and ignored paths are absent from every uploaded bundle.
- [ ] Confirm replayed bundles, tampered signatures, expired upload tokens and modified scanner builds are rejected.
- [ ] Confirm an anonymous/public-share token cannot read inspection evidence or paid reports.
- [ ] Review every high/critical rule for false-positive wording and a safe, actionable remediation.
- [ ] Publish the scanner architecture, trust boundaries, rules and limitations.

## Required before controlled customer access

- [ ] Configure the registered operator name, correspondence address, jurisdiction and support email.
- [ ] Obtain legal review of Terms, Privacy Notice, data-processing language and authorised-scanning terms.
- [ ] Verify Stripe live products, webhook delivery and refund procedures.
- [ ] Verify the Resend sending domain and password-reset/report delivery.
- [ ] Confirm persistent storage, encrypted backups and a documented restore procedure.
- [ ] Enable uptime, error, disk-capacity and backup monitoring.
- [ ] Confirm scan data retention and account deletion remove all inspection records.
- [ ] Test the full browser → token → local scan → upload → report → rescan workflow on production infrastructure.

## Required before broad commercial launch

- [ ] Complete independent penetration testing of the web application and upload API.
- [ ] Arrange independent review of the Inspector rules and scoring methodology by a qualified AI/AppSec practitioner.
- [ ] Sign scanner release manifests with an offline release key and document key rotation/revocation.
- [ ] Add software-bill-of-materials and reproducible-release evidence for the scanner package.
- [ ] Establish a vulnerability disclosure process and security response SLA.
- [ ] Complete accessibility, Windows, macOS and Linux compatibility testing.
- [ ] Document false-positive appeal, accepted-risk and retest procedures.
- [ ] Add customer-facing status and incident-communication procedures.

## Controlled beta targets

- [ ] Recruit 10–20 developers, security engineers and AI consultancies.
- [ ] Measure scanner completion, upload success and report download rates.
- [ ] Review all critical/high findings manually during beta.
- [ ] Measure false-positive, false-negative and “not applicable” feedback per rule.
- [ ] Measure time-to-remediate and whether rescans verify improvement.
- [ ] Release every rule/scoring change under a new policy/model version.

## Controlled-beta gates (v4.1)

- [ ] Create and verify a live SQLite backup before deploying
- [ ] Complete a restore drill from that exact backup
- [ ] Confirm `/api/health` reports `4.1.0` and `controlled-beta`
- [ ] Confirm malformed JSON receives HTTP 400
- [ ] Confirm the public sample PDF is the 22-page premium version
- [ ] Confirm the Inspector self-scan reports zero active findings
- [ ] Run the 5-trial hardened simulation and retain the signed result
- [ ] Confirm staging token creation is blocked without written Rules of Engagement
- [ ] Confirm revoked and expired authorisations cannot issue or accept staging evidence
- [ ] Review the first 20 customer reports manually for false positives and unclear remediation
- [ ] Do not claim independent penetration testing, certification or enterprise audit
