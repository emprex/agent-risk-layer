# AgentRiskLayer operations runbook — current local product

The public presentation/request site is **static**. Human-led security assessment, exact-SHA target binding, evidence and decisions run through the **local** canonical ARL product backed by **local PostgreSQL**.

## Public static-site operations

- Check the deployed homepage, assessment, methodology, trust, privacy, terms and request pages.
- Verify the **configured request intake** actually delivers and preserves an enquiry without requesting credentials, tokens or production secrets. Static HTML alone is not a delivery service.
- Review the static hosting deployment state and logs; there is no ARL Render application API/database to probe or restart.
- Verify service claims remain scope-and-quote, evidence-limited and not falsely accredited.
- On a website incident, preserve relevant request-channel records, halt a compromised integration and republish known-good static assets as authorised.

Do not probe `/api/health`, `/api/ready` or hosted Operator endpoints as checks for the static site.

## Local Operator operations (Debian)

1. Work from the single canonical checkout `~/agent-risk-layer`. Pull reviewed `main` only when needed and never reset or overwrite local changes.
2. Confirm the operator's `.env` provides the **local PostgreSQL `DATABASE_URL`**; SQLite is test-only. Never paste secrets into support messages.
3. Establish customer agreement, exact scope, asset inventory, environment and authorised target repository separately from the ARL product checkout.
4. Freeze the clean target Git SHA. If the target is dirty or mismatched, stop; do not edit target code to force a PASS.
5. Open the existing offline review dossier using `npm run operator:open -- "$HOME/arl-target-mcp-agent"`. This prepares private HTML; it does not run tests, accept evidence or resolve HOLD. On a new target it can create initial local PostgreSQL assessment records.
6. Review the source-evidence work plan, human documentation and runtime authorisation gaps. The same control may require several evidence types.
7. For any controlled test, first obtain written Rules of Engagement, staging/synthetic scope, bounded allowed cases, tester attribution and valid window. No live external target testing by default.
8. Record provenance and accountable decisions through the existing authoritative ARL workflow, not the offline HTML or an LLM. Maintain snapshot/digest lineage.
9. After remediation, require an exact affected-path retest on the changed build and attributable evidence before human finding-closure review.
10. Export the customer report with unsupported paths, limitations and remaining HOLD explicitly shown. Only an authorised human records the final deployment decision. The export creates private, immutable Markdown/JSON/manifest files named with the assessed target revision **and a truncated SHA-256 bundle identifier**. A later evidence or review update on the *same target revision* produces a separate immutable bundle rather than overwriting an earlier report. The SHA-256 identifier proves content correspondence only; it is **not** a cryptographic signature, reviewer approval, finding closure or release authority.

## Local data recovery

Use the existing `npm run db:backup`, `npm run db:verify-backup` and approved `npm run db:restore` procedures where applicable. Restore is a separately approved, potentially destructive maintenance action: validate the destination, checksum, retention and downtime plan first. Render has no current ARL product database to restore.

## Commercial and authority boundaries

The offer is **request → scope → quote/agreement → human-led security assessment**. No active Stripe checkout, hosted Operator session or self-service subscription path is required.

**The LLM is not the security authority.** A green CI job, a static source observation or a synthetic dashboard cannot decide applicability, severity, evidence validity, finding closure, readiness or deployment.
