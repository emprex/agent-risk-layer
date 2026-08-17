# AgentRiskLayer production hardening audit — 2026-08-17

## Assessment identity

- Repository: `emprex/agent-risk-layer`
- Baseline: `b239b95386f4474a76b0d830d3b1aaab6fe4c4cb`
- Audit branch: `audit/production-hardening-20260817`
- Product version declared in code: `10.1.1`
- Control profile: `ARL-RKA-1.2.0`
- Assessment type: proprietary code/security review and remediation. This is not an accredited certification and is not a guarantee that the system is risk-free.

## Evidence principles preserved

- Runtime completion is not a deployment decision.
- Architecture matching is decision support, not a finding and not confirmed applicability.
- Unknown or inconclusive information is not converted into a vulnerability.
- Historical assessment evidence is not rewritten by later runtime evidence.
- High-impact approvals remain bound to the exact action/context.

## Corrected defects

The branch corrects the previously documented Control Intelligence suggestion-confidence issue, production CSRF origin trust, authentication single-use/MFA races, workspace/SCIM owner and identity integrity, model provenance validation and SafeTensors range validation.

It also closes the three findings that were still listed as open in the earlier audit text:

### Assessment ownership claim race — closed

`claimAssessmentForUser` now performs one conditional database `UPDATE`. Ownership changes only when the assessment ID and access token match and the row is still unclaimed or already belongs to the same user. The previous read-then-write claim window is removed.

### Red-team quota reservation race — closed

Red-team token creation now runs in a database transaction, serializes per-account requests on PostgreSQL, counts completed runs plus active unused token reservations, and inserts the reservation before releasing the transaction. Expired unused tokens release their reservation. `tests/redteam-quota-concurrency.test.js` covers concurrent issuance and expiry release.

### Generic webhook SSRF boundary — closed for public webhook destinations

Outbound integrations now require credential-free HTTPS public Internet destinations. DNS is resolved before connection; any private/reserved answer causes rejection; the chosen public address is pinned into the HTTPS request, preventing a second DNS lookup from rebinding the destination. Redirect following is not used and delivery is timeout-bounded. `tests/outbound-http.test.js` covers local/private addresses, mixed public/private DNS answers and public address pinning.

Private enterprise webhook destinations remain intentionally unsupported by this policy. Supporting them later requires an explicit customer-controlled egress/allowlist design rather than weakening the public-destination boundary.

## Verification completed

GitHub Actions CI run #35 for branch commit `4218bd018ac0406ae8a82c1b7d8d3390d6fe6e8d` completed successfully. Syntax checks, the complete unit/integration test stage, scenario regression and detection regression all passed. A focused repair run also passed 41/41 targeted tests before the complete CI run.

At final review, `main` remained at baseline `b239b95386f4474a76b0d830d3b1aaab6fe4c4cb`, PR #71 was mergeable and there were no unresolved review threads.

## Remaining deployment-verification obligations

These are not unresolved source findings and do not block merge, but they must be verified against the exact merged/deployed commit before any production-readiness claim:

1. Render deploys the exact merged `main` commit and `/api/health` and `/api/ready` are healthy with the expected PostgreSQL schema.
2. Customer journey is verified end to end: account creation → sign-in → assessment → findings/report → payment → Stripe webhook → email → dashboard → remediation → retest → subscription management.
3. Stripe live processing is confirmed without changing existing live prices or payment configuration.
4. Transactional email delivery is confirmed with the existing provider/configuration.
5. PostgreSQL backup and restoration evidence is confirmed.
6. Critical public/authenticated pages and responsive behaviour are checked in production.
7. Runtime completion remains distinct from a deployment decision; deployment evidence and human review remain required.

## Branch decision

**Ready to merge for deployment verification.**

This is a source/CI decision only. It is not a certification, a guarantee of security or a claim that production verification has already completed.
